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
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  markNotificationRead,
  markAllNotificationsRead,
  NotificationPollCursor,
  NotificationRecord,
  pollNotifications,
} from './data/notifications';
import { IncidentCard, INCIDENT_UPDATE_EVENT } from './data/incidents';

// Polling cadence. Each poll is one short request that returns at once -
// nothing is held open between polls, however many tabs are open.
const VISIBLE_POLL_MS = 12_000;
const HIDDEN_POLL_MS = 45_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** Newest-first list with `incoming` (oldest-first) added, no duplicates. */
const mergeNew = (
  current: NotificationRecord[],
  incoming: NotificationRecord[],
) => {
  const known = new Set(current.map(item => item.id));
  const fresh = incoming.filter(item => !known.has(item.id)).reverse();
  return fresh.length ? [...fresh, ...current] : current;
};

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

  // In-app delivery by short polling of persisted notifications (the
  // Notification table is the source of truth). First poll: unread list +
  // cursor; then only notifications newer than the cursor and incident
  // status changes since the last poll. Every 12s while visible, 45s while
  // hidden, immediately on becoming visible; one request in flight at a
  // time; quiet exponential backoff on errors.
  useEffect(() => {
    if (!userId) return undefined;
    const pollUserId: number = userId;

    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let visiblePollMs = VISIBLE_POLL_MS;
    let cursor: NotificationPollCursor | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const nextDelay = () => {
      const base = document.hidden ? HIDDEN_POLL_MS : visiblePollMs;
      return Math.min(base * 2 ** failures, MAX_BACKOFF_MS);
    };

    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(tick, delay);
    };

    async function tick() {
      if (cancelled || inFlight) return;
      inFlight = true;
      const result = await pollNotifications(pollUserId, cursor);
      inFlight = false;
      if (cancelled) return;
      if (!result) {
        failures = Math.min(failures + 1, 5);
        schedule(nextDelay());
        return;
      }

      failures = 0;
      const bootstrap = cursor === null;
      ({ cursor } = result);
      if (
        result.poll_interval_seconds >= 10 &&
        result.poll_interval_seconds <= 15
      ) {
        visiblePollMs = result.poll_interval_seconds * 1000;
      }
      setUnreadCount(result.unread_count);
      if (bootstrap) {
        setNotifications(result.notifications);
      } else if (result.notifications.length) {
        setNotifications(prev => mergeNew(prev, result.notifications));
      }
      if (result.incident_updates.length) {
        const cards = new Map(
          result.incident_updates.map(update => [update.alert_id, update]),
        );
        setNotifications(prev =>
          prev.map(item =>
            cards.has(item.alert_id)
              ? { ...item, incident: cards.get(item.alert_id)!.incident }
              : item,
          ),
        );
        // Lets an open incident page reload (see IncidentPanel).
        result.incident_updates.forEach(update =>
          window.dispatchEvent(
            new CustomEvent(INCIDENT_UPDATE_EVENT, { detail: update }),
          ),
        );
      }
      // A burst larger than one page: fetch the rest right away.
      schedule(result.has_more ? 0 : nextDelay());
    }

    const onVisibilityChange = () => {
      if (!document.hidden) schedule(0);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [userId]);

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
