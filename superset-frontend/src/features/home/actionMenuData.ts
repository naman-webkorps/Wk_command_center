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

export const ACTION_INTEGRATION_PATH = '/integration/list/';
export const ACTION_EVENT_PATH = '/event/list/';
export const ACTION_ALERT_PATH = '/action-alert/list/';

export const actionMenuData = {
  name: t('Action'),
  tabs: [
    {
      name: 'Integration',
      label: t('Integration'),
      url: ACTION_INTEGRATION_PATH,
      usesRouter: true,
    },
    {
      name: 'Event',
      label: t('Incident'),
      url: ACTION_EVENT_PATH,
      usesRouter: true,
    },
    {
      name: 'Alert',
      label: t('Alert'),
      url: ACTION_ALERT_PATH,
      usesRouter: true,
    },
  ],
};
