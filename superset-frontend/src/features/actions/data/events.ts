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
import { extendedDayjs } from '@superset-ui/core/utils/dates';
import { EventRecord } from './types';

// The Command Center Rails API is a separate backend/origin from Superset
// itself (see backend ARCHITECTURE.md + config/initializers/cors.rb,
// which allows this frontend's origin specifically). `host`/`mode` are
// passed per-call rather than configuring a second SupersetClient
// instance, since every other call in this app should keep hitting
// Superset's own backend unaffected.
const COMMAND_CENTER_API_HOST = 'localhost:3001';
const CROSS_ORIGIN = { host: COMMAND_CENTER_API_HOST, mode: 'cors' as const };

interface BackendEventDefinition {
  id: number;
  name: string;
  group: string;
  type: string;
  created_at: string;
  updated_at: string;
}

const toEventRecord = (item: BackendEventDefinition): EventRecord => ({
  id: item.id,
  name: item.name,
  groupId: item.group,
  eventTypeId: item.type,
  changed_on_delta_humanized: extendedDayjs.utc(item.updated_at).fromNow(),
});

// EventDefinition's validation errors come back as `{ error: [...] }` (or
// occasionally a bare string) - join array messages into one readable line
// rather than letting them stringify as "msg1,msg2".
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

export const fetchEvents = async (
  addDangerToast: (message: string) => void,
): Promise<EventRecord[]> => {
  try {
    const { json } = await SupersetClient.get({
      ...CROSS_ORIGIN,
      endpoint: '/api/v1/events',
    });
    return (json as BackendEventDefinition[]).map(toEventRecord);
  } catch (response) {
    await reportError(
      response,
      addDangerToast,
      t('Error while fetching incidents'),
    );
    return [];
  }
};

export interface NewEventInput {
  name: string;
  groupId: string;
  eventTypeId: string;
}

const toEventPayload = (input: NewEventInput) => ({
  event: {
    name: input.name,
    group: input.groupId,
    type: input.eventTypeId,
  },
});

export const createEvent = async (
  input: NewEventInput,
  addDangerToast: (message: string) => void,
): Promise<EventRecord | null> => {
  try {
    const { json } = await SupersetClient.post({
      ...CROSS_ORIGIN,
      endpoint: '/api/v1/events',
      jsonPayload: toEventPayload(input),
    });
    return toEventRecord(json as BackendEventDefinition);
  } catch (response) {
    await reportError(
      response,
      addDangerToast,
      t('Error while creating incident'),
    );
    return null;
  }
};

export const updateEvent = async (
  id: number,
  input: NewEventInput,
  addDangerToast: (message: string) => void,
): Promise<EventRecord | null> => {
  try {
    const { json } = await SupersetClient.put({
      ...CROSS_ORIGIN,
      endpoint: `/api/v1/events/${id}`,
      jsonPayload: toEventPayload(input),
    });
    return toEventRecord(json as BackendEventDefinition);
  } catch (response) {
    await reportError(
      response,
      addDangerToast,
      t('Error while updating incident'),
    );
    return null;
  }
};

export const deleteEvent = async (
  id: number,
  addDangerToast: (message: string) => void,
): Promise<boolean> => {
  try {
    await SupersetClient.delete({
      ...CROSS_ORIGIN,
      endpoint: `/api/v1/events/${id}`,
    });
    return true;
  } catch (response) {
    await reportError(
      response,
      addDangerToast,
      t('Error while deleting incident'),
    );
    return false;
  }
};
