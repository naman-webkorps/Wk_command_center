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
import { t } from '@apache-superset/core/translation';
import { DeleteModal } from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import SubMenu from 'src/features/home/SubMenu';
import {
  ListView,
  ListViewActionsBar,
  ListViewFilterOperator as FilterOperator,
  type ListViewActionProps,
  type ListViewFilters,
} from 'src/components';
import withToasts from 'src/components/MessageToasts/withToasts';
import { actionMenuData } from 'src/features/home/actionMenuData';
import { useMockListState } from 'src/features/actions/hooks/useMockListState';
import {
  fetchEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} from 'src/features/actions/data/events';
import {
  EVENT_GROUP_OPTIONS,
  findEventGroupOption,
  findEventTypeOption,
} from 'src/features/actions/data/eventGroups';
import { EventRecord } from 'src/features/actions/data/types';
import EventModal from 'src/features/actions/EventModal';

const PAGE_SIZE = 25;

interface EventListProps {
  addDangerToast: (msg: string) => void;
  addSuccessToast: (msg: string) => void;
}

function EventList({ addDangerToast, addSuccessToast }: EventListProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshData = useCallback(() => {
    setLoading(true);
    fetchEvents(addDangerToast).then(items => {
      setEvents(items);
      setLoading(false);
    });
  }, [addDangerToast]);
  useEffect(() => {
    refreshData();
  }, [refreshData]);
  const { rows, count, fetchData } = useMockListState<EventRecord>(events);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [eventBeingEdited, setEventBeingEdited] = useState<EventRecord | null>(
    null,
  );
  const [eventCurrentlyDeleting, setEventCurrentlyDeleting] =
    useState<EventRecord | null>(null);

  const handleSave = useCallback(
    (input: { name: string; groupId: string; eventTypeId: string }) => {
      const save = eventBeingEdited
        ? updateEvent(eventBeingEdited.id, input, addDangerToast)
        : createEvent(input, addDangerToast);
      save.then(saved => {
        if (!saved) return; // error already toasted by data/events.ts
        setModalOpen(false);
        setEventBeingEdited(null);
        refreshData();
        addSuccessToast(
          eventBeingEdited ? t('Incident updated') : t('Incident created'),
        );
      });
    },
    [eventBeingEdited, refreshData, addSuccessToast, addDangerToast],
  );

  const handleDeleteConfirm = useCallback(() => {
    if (!eventCurrentlyDeleting) return;
    deleteEvent(eventCurrentlyDeleting.id, addDangerToast).then(success => {
      if (!success) return;
      addSuccessToast(t('Deleted: %s', eventCurrentlyDeleting.name));
      setEventCurrentlyDeleting(null);
      refreshData();
    });
  }, [eventCurrentlyDeleting, refreshData, addSuccessToast, addDangerToast]);

  const columns = useMemo(
    () => [
      { accessor: 'name', Header: t('Name'), id: 'name', size: 'xl' },
      {
        Cell: ({ row: { original } }: { row: { original: EventRecord } }) =>
          findEventGroupOption(original.groupId)?.label ?? original.groupId,
        accessor: 'groupId',
        Header: t('Group'),
        id: 'groupId',
        size: 'lg',
      },
      {
        Cell: ({ row: { original } }: { row: { original: EventRecord } }) =>
          findEventTypeOption(original.eventTypeId)?.label ??
          original.eventTypeId,
        accessor: 'eventTypeId',
        Header: t('Incident'),
        id: 'eventTypeId',
        size: 'lg',
      },
      {
        accessor: 'changed_on_delta_humanized',
        Header: t('Last modified'),
        id: 'changed_on_delta_humanized',
        size: 'lg',
      },
      {
        Cell: ({ row: { original } }: { row: { original: EventRecord } }) => {
          const actions: ListViewActionProps[] = [
            {
              label: 'edit-action',
              tooltip: t('Edit incident'),
              placement: 'bottom',
              icon: 'EditOutlined',
              onClick: () => {
                setEventBeingEdited(original);
                setModalInstanceKey(key => key + 1);
                setModalOpen(true);
              },
            },
            {
              label: 'delete-action',
              tooltip: t('Delete incident'),
              placement: 'bottom',
              icon: 'DeleteOutlined',
              onClick: () => setEventCurrentlyDeleting(original),
            },
          ];
          return <ListViewActionsBar actions={actions} />;
        },
        Header: t('Actions'),
        id: 'actions',
        disableSortBy: true,
        size: 'xl',
      },
    ],
    [],
  );

  const filters: ListViewFilters = useMemo(
    () => [
      {
        Header: t('Name'),
        key: 'search',
        id: 'name',
        input: 'search',
        operator: FilterOperator.Contains,
      },
      {
        Header: t('Group'),
        key: 'groupId',
        id: 'groupId',
        input: 'select',
        operator: FilterOperator.Equals,
        unfilteredLabel: t('All'),
        selects: EVENT_GROUP_OPTIONS.map(group => ({
          label: group.label,
          value: group.id,
        })),
      },
    ],
    [],
  );

  return (
    <>
      <SubMenu
        name={t('Incidents')}
        activeChild="Event"
        tabs={actionMenuData.tabs}
        buttons={[
          {
            icon: <Icons.PlusOutlined iconSize="m" />,
            name: t('Incident'),
            onClick: () => {
              setEventBeingEdited(null);
              setModalInstanceKey(key => key + 1);
              setModalOpen(true);
            },
            buttonStyle: 'primary',
          },
        ]}
      />
      <EventModal
        key={modalInstanceKey}
        show={modalOpen}
        event={eventBeingEdited}
        onHide={() => {
          setModalOpen(false);
          setEventBeingEdited(null);
        }}
        onSave={handleSave}
      />
      {eventCurrentlyDeleting && (
        <DeleteModal
          description={t(
            'This will permanently remove this incident. This action cannot be undone.',
          )}
          onConfirm={handleDeleteConfirm}
          onHide={() => setEventCurrentlyDeleting(null)}
          open
          title={t('Delete %s?', eventCurrentlyDeleting.name)}
        />
      )}
      <ListView<EventRecord>
        className="event-list-view"
        columns={columns}
        data={rows}
        count={count}
        pageSize={PAGE_SIZE}
        fetchData={fetchData}
        filters={filters}
        loading={loading}
        addDangerToast={addDangerToast}
        addSuccessToast={addSuccessToast}
        refreshData={refreshData}
      />
    </>
  );
}

export default withToasts(EventList);
