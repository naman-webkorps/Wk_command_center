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
import type { IncidentCard } from './incidents';
import { CROSS_ORIGIN } from './commandCenterHost';

// See ./commandCenterHost for why this is needed, where the host comes
// from, and how to switch it at runtime.

export interface NotificationRecord {
  id: number;
  alert_id: number;
  channel: 'in_app' | 'slack';
  status: 'pending' | 'delivered' | 'failed';
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  /** Shared incident card (same content as Slack); null for ordinary alerts. */
  incident?: IncidentCard | null;
  read: boolean;
  read_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

const describeError = (error: unknown): string =>
  Array.isArray(error) ? error.join(', ') : String(error);

async function reportError(
  response: unknown,
  addDangerToast: (message: string) => void,
  fallback: string,
) {
  try {
    const { error } = await getClientErrorObject(
      response as Parameters<typeof getClientErrorObject>[0],
    );
    const detail = (error as { error?: unknown })?.error;
    addDangerToast(detail ? describeError(detail) : fallback);
  } catch {
    addDangerToast(fallback);
  }
}

// The backend identifies "the current user" via this header - see
// SupersetUserIdentifiable on the Rails side for why (Superset's own
// already-authenticated session, read here from Redux state hydrated from
// Superset's bootstrap data - see NotificationBell.tsx).
const identityHeaders = (userId: number) => ({
  'X-Superset-User-Id': String(userId),
});

export const fetchNotifications = async (
  userId: number,
  addDangerToast: (message: string) => void,
): Promise<NotificationRecord[]> => {
  try {
    const { json } = await SupersetClient.get({
      ...CROSS_ORIGIN,
      // In-app items only - Slack rows are that channel's delivery records.
      endpoint: '/api/v1/notifications?channel=in_app',
      headers: identityHeaders(userId),
    });
    return json as NotificationRecord[];
  } catch (response) {
    await reportError(
      response,
      addDangerToast,
      t('Error while fetching notifications'),
    );
    return [];
  }
};

export const fetchUnreadNotifications = async (
  userId: number,
  addDangerToast: (message: string) => void,
): Promise<NotificationRecord[]> => {
  try {
    const { json } = await SupersetClient.get({
      ...CROSS_ORIGIN,
      endpoint: '/api/v1/notifications/unread?channel=in_app',
      headers: identityHeaders(userId),
    });
    return json as NotificationRecord[];
  } catch (response) {
    await reportError(
      response,
      addDangerToast,
      t('Error while fetching notifications'),
    );
    return [];
  }
};

export const fetchNotificationById = async (
  userId: number,
  id: number,
  addDangerToast: (message: string) => void,
): Promise<NotificationRecord | null> => {
  try {
    const { json } = await SupersetClient.get({
      ...CROSS_ORIGIN,
      endpoint: `/api/v1/notifications/${id}`,
      headers: identityHeaders(userId),
    });
    return json as NotificationRecord;
  } catch (response) {
    await reportError(
      response,
      addDangerToast,
      t('Error while fetching notification'),
    );
    return null;
  }
};

export const markNotificationRead = async (
  userId: number,
  id: number,
  addDangerToast: (message: string) => void,
): Promise<NotificationRecord | null> => {
  try {
    // No .patch() on SupersetClientInterface (only get/post/put/delete) -
    // .request() with an explicit method is the documented way to issue
    // any other verb.
    const { json } = await SupersetClient.request({
      ...CROSS_ORIGIN,
      method: 'PATCH',
      endpoint: `/api/v1/notifications/${id}/read`,
      headers: identityHeaders(userId),
    });
    return json as NotificationRecord;
  } catch (response) {
    await reportError(
      response,
      addDangerToast,
      t('Error while marking notification read'),
    );
    return null;
  }
};

/**
 * There's no bulk "mark all read" endpoint on the Rails side, so this
 * fires the existing per-notification PATCH for each unread id and waits
 * for all of them - a reasonable client-side stand-in for a handful of
 * notifications, without needing a new backend endpoint.
 */
export const markAllNotificationsRead = async (
  userId: number,
  unreadIds: number[],
  addDangerToast: (message: string) => void,
): Promise<boolean> => {
  const results = await Promise.all(
    unreadIds.map(id => markNotificationRead(userId, id, addDangerToast)),
  );
  return results.every(result => result !== null);
};

/** Where the next poll continues from (both values come from the server). */
export interface NotificationPollCursor {
  after_id: number;
  since: string;
}

export interface NotificationPollResult {
  notifications: NotificationRecord[];
  incident_updates: {
    alert_id: number;
    status: string;
    incident: IncidentCard | null;
  }[];
  unread_count: number;
  has_more: boolean;
  cursor: NotificationPollCursor;
  poll_interval_seconds: number;
}

/**
 * One short, bounded poll of persisted in-app notifications (the delivery
 * transport - there is no long-lived connection). Without a cursor it
 * returns the unread list and a cursor; with one, only notifications
 * newer than `after_id` plus incident status changes since `since`.
 * Errors are not toasted: polling retries quietly on its next tick.
 */
export const pollNotifications = async (
  userId: number,
  cursor: NotificationPollCursor | null,
): Promise<NotificationPollResult | null> => {
  const query = cursor
    ? `?after_id=${cursor.after_id}&since=${encodeURIComponent(cursor.since)}`
    : '';
  try {
    const { json } = await SupersetClient.get({
      ...CROSS_ORIGIN,
      endpoint: `/api/v1/notifications/poll${query}`,
      headers: identityHeaders(userId),
    });
    return json as NotificationPollResult;
  } catch {
    return null;
  }
};
