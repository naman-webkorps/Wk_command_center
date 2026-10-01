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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { t } from '@apache-superset/core/translation';
import { styled, useTheme } from '@apache-superset/core/theme';
import { Badge, Popover, Tag } from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { addDangerToast } from 'src/components/MessageToasts/actions';
import { UserWithPermissionsAndRoles } from 'src/types/bootstrapTypes';
import {
  fetchNotifications,
  fetchUnreadNotifications,
  fetchSseTicket,
  markNotificationRead,
  markAllNotificationsRead,
  notificationStreamUrl,
  NotificationRecord,
} from './data/notifications';
import { IncidentCard, INCIDENT_UPDATE_EVENT } from './data/incidents';

const FloatingWrapper = styled.div`
  ${({ theme }) => `
    position: fixed;
    right: ${theme.sizeUnit * 6}px;
    /* Stacked above AiChatWidget's 56px floating button. */
    bottom: calc(${theme.sizeUnit * 6}px + 56px + ${theme.sizeUnit * 3}px);
    z-index: ${theme.zIndexPopupBase};
  `}
`;

const BellButton = styled.button`
  ${({ theme }) => `
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    background: ${theme.colorPrimary};
    box-shadow: ${theme.boxShadowSecondary};
    transition: transform 0.15s ease;

    &:hover {
      transform: scale(1.06);
    }

    &:focus-visible {
      outline: 2px solid ${theme.colorPrimaryBorderHover};
      outline-offset: 2px;
    }

    .anticon {
      color: ${theme.colorWhite};
    }

    /* Sized directly on the svg (matching AiChatWidget's launcher button)
       rather than via .anticon's font-size: antd's own icon font-size rule
       has matching specificity and wins unpredictably depending on
       CSS-in-JS injection order, same class of bug as elsewhere in the
       header (see Menu.tsx/RightMenu.tsx). */
    svg {
      width: 24px !important;
      height: 24px !important;
    }
  `}
`;

const PanelContainer = styled.div`
  width: 320px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
`;

const PanelHeader = styled.div`
  ${({ theme }) => `
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${theme.sizeUnit * 2}px;
    padding: ${theme.sizeUnit * 2}px ${theme.sizeUnit * 3}px;
    border-bottom: 1px solid ${theme.colorBorder};

    .panel-title {
      font-weight: ${theme.fontWeightStrong};
      color: ${theme.colorText};
    }

    .mark-all-read {
      background: none;
      border: none;
      padding: 0;
      font-size: ${theme.fontSizeSM}px;
      color: ${theme.colorPrimary};
      cursor: pointer;

      &:disabled {
        color: ${theme.colorTextDisabled};
        cursor: not-allowed;
      }
    }
  `}
`;

const PanelBody = styled.div`
  overflow-y: auto;
`;

const PanelFooter = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 2}px ${theme.sizeUnit * 3}px;
    border-top: 1px solid ${theme.colorBorder};
    text-align: center;

    a {
      font-size: ${theme.fontSizeSM}px;
      color: ${theme.colorPrimary};
    }
  `}
`;

const NotificationItem = styled.div<{ read: boolean }>`
  ${({ theme, read }) => `
    padding: ${theme.sizeUnit * 2}px ${theme.sizeUnit * 3}px;
    cursor: pointer;
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    font-weight: ${read ? theme.fontWeightNormal : theme.fontWeightStrong};

    &:hover {
      background-color: ${theme.colorBgTextHover};
    }

    &:last-child {
      border-bottom: none;
    }
  `}
`;

const IncidentLine = styled.div`
  ${({ theme }) => `
    margin-top: ${theme.sizeUnit}px;
    color: ${theme.colorTextSecondary};
    font-size: ${theme.fontSizeSM}px;
    font-weight: ${theme.fontWeightNormal};

    .ant-tag {
      margin-inline-end: ${theme.sizeUnit}px;
      font-size: ${theme.fontSizeSM - 1}px;
      line-height: 16px;
    }
  `}
`;

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'error',
  warning: 'warning',
  info: 'processing',
};

// One compact line from the shared incident card: the same facts Slack shows.
const incidentSummary = (incident: IncidentCard) =>
  [
    incident.vehicle,
    incident.route ?? incident.hub,
    // Hours-converted on the backend (90 min -> "+1.5 hours").
    incident.delay_label ?? null,
    incident.waybill_count != null
      ? `${incident.waybill_count} waybills`
      : null,
    incident.revenue_risk != null
      ? `₹${Math.round(incident.revenue_risk).toLocaleString('en-IN')}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

const EmptyState = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 4}px ${theme.sizeUnit * 3}px;
    color: ${theme.colorTextSecondary};
    text-align: center;
  `}
`;

export default function NotificationBell() {
  const theme = useTheme();
  const history = useHistory();
  const dispatch = useDispatch();
  const danger = useCallback(
    (message: string) => dispatch(addDangerToast(message)),
    [dispatch],
  );
  const user = useSelector<any, UserWithPermissionsAndRoles>(
    state => state.user,
  );
  const userId = user?.userId;

  const [visible, setVisible] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Initial unread notifications + count, and the realtime SSE connection.
  // Missed-during-disconnect notifications are recovered simply by this
  // unread fetch running again on remount/reconnect - the durable source
  // of truth is always the backend, never anything buffered client-side
  // only in this effect.
  useEffect(() => {
    if (!userId) return undefined;

    fetchUnreadNotifications(userId, danger).then(items => {
      setNotifications(items);
      setUnreadCount(items.length);
    });

    let cancelled = false;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const baseReconnectDelay = 1000; // Start at 1s, exponential backoff

    const connectStream = async () => {
      if (cancelled) return;

      try {
        const ticket = await fetchSseTicket(userId, danger);
        if (!ticket || cancelled) return;

        reconnectAttempts = 0; // Reset on successful connection
        const source = new EventSource(notificationStreamUrl(ticket));
        eventSourceRef.current = source;

        source.addEventListener('notification', (event: MessageEvent) => {
          const notification = JSON.parse(event.data) as NotificationRecord;
          setNotifications(prev => [notification, ...prev]);
          setUnreadCount(prev => prev + 1);
        });

        // Status/assignment changes made by anyone (in-app or from a Slack
        // link): refresh matching items and let an open incident page
        // reload - over this same stream, no second connection.
        source.addEventListener('incident_update', (event: MessageEvent) => {
          const update = JSON.parse(event.data) as {
            alert_id: number;
            incident: IncidentCard | null;
          };
          setNotifications(prev =>
            prev.map(item =>
              item.alert_id === update.alert_id
                ? { ...item, incident: update.incident }
                : item,
            ),
          );
          window.dispatchEvent(
            new CustomEvent(INCIDENT_UPDATE_EVENT, { detail: update }),
          );
        });

        source.addEventListener('error', () => {
          // EventSource error - likely 401 from expired ticket or network error
          source.close();
          eventSourceRef.current = null;

          if (!cancelled) {
            // Exponential backoff: 1s, 2s, 4s, 8s, 16s, then stop retrying
            const delay = Math.min(
              baseReconnectDelay * Math.pow(2, reconnectAttempts),
              30000, // Cap at 30s
            );
            reconnectAttempts += 1;

            if (reconnectAttempts <= maxReconnectAttempts) {
              setTimeout(connectStream, delay);
            }
          }
        });
      } catch (error) {
        // Error fetching ticket - don't retry, rely on normal effect re-run
        if (!cancelled) {
          reconnectAttempts += 1;
          if (reconnectAttempts <= maxReconnectAttempts) {
            const delay = Math.min(
              baseReconnectDelay * Math.pow(2, reconnectAttempts),
              30000,
            );
            setTimeout(connectStream, delay);
          }
        }
      }
    };

    connectStream();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [userId, danger]);

  const handleVisibleChange = (nextVisible: boolean) => {
    setVisible(nextVisible);
    if (nextVisible && userId) {
      fetchNotifications(userId, danger).then(setNotifications);
    }
  };

  const handleSelectNotification = (notification: NotificationRecord) => {
    setVisible(false);
    if (userId && !notification.read) {
      markNotificationRead(userId, notification.id, danger);
      setNotifications(prev =>
        prev.map(item =>
          item.id === notification.id ? { ...item, read: true } : item,
        ),
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
    // Incidents drill into the incident itself; others keep the
    // notification page.
    history.push(
      notification.incident
        ? `/incident/${notification.alert_id}`
        : `/notification/${notification.id}`,
    );
  };

  const unreadIds = useMemo(
    () => notifications.filter(item => !item.read).map(item => item.id),
    [notifications],
  );

  const handleMarkAllRead = () => {
    if (!userId || unreadIds.length === 0) return;
    markAllNotificationsRead(userId, unreadIds, danger).then(success => {
      if (!success) return;
      setNotifications(prev => prev.map(item => ({ ...item, read: true })));
      setUnreadCount(0);
    });
  };

  const handleViewAll = () => {
    setVisible(false);
    history.push('/notification/list/');
  };

  const content = (
    <PanelContainer>
      <PanelHeader>
        <span className="panel-title">{t('Notifications')}</span>
        <button
          type="button"
          className="mark-all-read"
          disabled={unreadIds.length === 0}
          onClick={handleMarkAllRead}
          data-test="mark-all-read"
        >
          {t('Mark all as read')}
        </button>
      </PanelHeader>
      <PanelBody>
        {notifications.length === 0 ? (
          <EmptyState>{t('No notifications')}</EmptyState>
        ) : (
          notifications.map(notification => (
            <NotificationItem
              key={notification.id}
              read={notification.read}
              role="button"
              tabIndex={0}
              onClick={() => handleSelectNotification(notification)}
            >
              {notification.title}
              {notification.incident && (
                <IncidentLine>
                  <Tag color={SEVERITY_COLORS[notification.incident.severity]}>
                    {notification.incident.severity}
                  </Tag>
                  <Tag>
                    {notification.incident.status
                      .replace('_', ' ')
                      .toUpperCase()}
                  </Tag>
                  {incidentSummary(notification.incident)}
                </IncidentLine>
              )}
            </NotificationItem>
          ))
        )}
      </PanelBody>
      <PanelFooter>
        <a
          role="button"
          tabIndex={0}
          onClick={handleViewAll}
          data-test="notification-view-all"
        >
          {t('View all notifications')}
        </a>
      </PanelFooter>
    </PanelContainer>
  );

  // Signed-in users only - this mirrors the `!navbarRight.user_is_anonymous`
  // gate this component used to be rendered behind in RightMenu.tsx before
  // it became a global, App-root-mounted floating widget.
  if (!userId) return null;

  return (
    <FloatingWrapper>
      <Popover
        content={content}
        trigger="click"
        placement="topRight"
        visible={visible}
        onVisibleChange={handleVisibleChange}
      >
        <BellButton
          type="button"
          data-test="notification-bell"
          aria-label={t('Notifications, %s unread', unreadCount)}
        >
          <Badge
            count={unreadCount}
            size="small"
            // Badge positions itself relative to its child - the 24px icon,
            // not the 56px button - so its default corner sits well inside
            // the circle. Pushed out to the button's own outer edge instead
            // of overlapping the icon glyph as the count grows to 2-3
            // digits (offset tuned against the icon's 16px inset within
            // the button, not just eyeballed).
            offset={[16, -16]}
            overflowCount={99}
            color={theme.colorError}
          >
            <Icons.BellOutlined />
          </Badge>
        </BellButton>
      </Popover>
    </FloatingWrapper>
  );
}
