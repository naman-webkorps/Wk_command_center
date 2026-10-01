/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { t } from '@apache-superset/core/translation';
import { SupersetClient, getClientErrorObject } from '@superset-ui/core';

// See data/events.ts: the Command Center Rails API is a separate origin.
const COMMAND_CENTER_API_HOST = 'localhost:3001';
const CROSS_ORIGIN = { host: COMMAND_CENTER_API_HOST, mode: 'cors' as const };

export interface IncidentPrincipal {
  type: 'user' | 'role';
  id: number;
  name: string | null;
}

export interface IncidentHistoryEntry {
  action: string;
  actor_id: number | null;
  actor_name?: string;
  at: string;
  note?: string;
  from_name?: string;
  to_name?: string;
}

export type IncidentStatus =
  | 'open'
  | 'acknowledged'
  | 'in_progress'
  | 'escalated'
  | 'resolved';

/**
 * The shared incident card (backend IncidentNotificationPresenter) - the
 * exact rows, links and actions Slack renders, carried on notifications,
 * SSE payloads and GET /api/v1/alerts/:id.
 */
export interface IncidentCard {
  alert_id: number;
  incident_type: string;
  incident_title: string;
  title: string;
  severity: string;
  status: IncidentStatus;
  triggered_at: string;
  summary?: string | null;
  vehicle?: string | null;
  route?: string | null;
  diversion_route?: string | null;
  hub?: string | null;
  destination?: string | null;
  delay_minutes?: number | null;
  /** delay_minutes formatted for display: "+45 min", "+1.5 hours". */
  delay_label?: string | null;
  waybill_count?: number | null;
  order_count?: number | null;
  revenue_risk?: number | null;
  assignment: {
    primary: IncidentPrincipal | null;
    secondary: IncidentPrincipal | null;
    current: IncidentPrincipal | null;
    level: string | null;
  };
  fields: { label: string; value: string }[];
  links: {
    incident?: string;
    vehicle?: string;
    route?: string;
    hub?: string;
    waybills?: string;
  };
  actions: string[];
  deep_link?: { type: string; id: string | number } | null;
}

export interface IncidentAlert {
  id: number;
  status: IncidentStatus;
  severity: string;
  rule_name: string;
  triggered_at: string;
  incident: { trip_id?: number | null; reason?: string | null } | null;
  card: IncidentCard | null;
  assignee: IncidentPrincipal | null;
  assignment_level: string | null;
  primary_assignee: IncidentPrincipal | null;
  secondary_assignee: IncidentPrincipal | null;
  escalation_level: number;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  history: IncidentHistoryEntry[];
}

export interface IncidentWaybill {
  id: number;
  waybill_number: string;
  status: string;
  customer: string | null;
  customer_count: number;
  total_packages: number;
  total_orders: number;
  expected_arrival_at: string | null;
  destination: { name: string } | null;
}

/** Window event NotificationBell re-dispatches for SSE incident updates. */
export const INCIDENT_UPDATE_EVENT = 'command-center:incident-update';

export type IncidentAction =
  | 'acknowledge'
  | 'assign'
  | 'reassign'
  | 'escalate'
  | 'resolve';

const identityHeaders = (userId: number) => ({
  'X-Superset-User-Id': String(userId),
});

async function toastError(
  response: unknown,
  addDangerToast: (message: string) => void,
  fallback: string,
) {
  try {
    const { error } = await getClientErrorObject(
      response as Parameters<typeof getClientErrorObject>[0],
    );
    const detail = (error as { error?: unknown })?.error;
    addDangerToast(detail ? String(detail) : fallback);
  } catch {
    addDangerToast(fallback);
  }
}

export const fetchIncidentAlert = async (
  id: number,
  addDangerToast: (message: string) => void,
): Promise<IncidentAlert | null> => {
  try {
    const { json } = await SupersetClient.get({
      ...CROSS_ORIGIN,
      endpoint: `/api/v1/alerts/${id}`,
    });
    return json as IncidentAlert;
  } catch (response) {
    await toastError(
      response,
      addDangerToast,
      t('Error while fetching incident'),
    );
    return null;
  }
};

/** POST /api/v1/alerts/:id/{acknowledge|escalate|resolve} as the current user. */
export const runIncidentAction = async (
  userId: number,
  id: number,
  action: IncidentAction,
  addDangerToast: (message: string) => void,
  body: Record<string, unknown> = {},
): Promise<IncidentAlert | null> => {
  try {
    const { json } = await SupersetClient.post({
      ...CROSS_ORIGIN,
      endpoint: `/api/v1/alerts/${id}/${action}`,
      headers: identityHeaders(userId),
      jsonPayload: body,
    });
    return json as IncidentAlert;
  } catch (response) {
    await toastError(
      response,
      addDangerToast,
      t('Error while updating incident'),
    );
    return null;
  }
};

export const fetchIncidentWaybills = async (
  tripId: number,
  addDangerToast: (message: string) => void,
): Promise<IncidentWaybill[]> => {
  try {
    const { json } = await SupersetClient.get({
      ...CROSS_ORIGIN,
      endpoint: `/api/v1/waybills?trip_id=${tripId}`,
    });
    return json as IncidentWaybill[];
  } catch (response) {
    await toastError(
      response,
      addDangerToast,
      t('Error while fetching waybills'),
    );
    return [];
  }
};
