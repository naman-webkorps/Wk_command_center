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
import { DeleteModal, Label } from '@superset-ui/core/components';
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
  fetchAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
} from 'src/features/actions/data/alerts';
import { AlertRuleRecord } from 'src/features/actions/data/types';
import AlertModal from 'src/features/actions/AlertModal';

const PAGE_SIZE = 25;

const SEVERITY_LABEL_TYPE: Record<string, 'default' | 'warning' | 'error'> = {
  info: 'default',
  warning: 'warning',
  critical: 'error',
};

interface ActionAlertListProps {
  addDangerToast: (msg: string) => void;
  addSuccessToast: (msg: string) => void;
}

function ActionAlertList({
  addDangerToast,
  addSuccessToast,
}: ActionAlertListProps) {
  const [alerts, setAlerts] = useState<AlertRuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshData = useCallback(() => {
    setLoading(true);
    fetchAlertRules(addDangerToast).then(items => {
      setAlerts(items);
      setLoading(false);
    });
  }, [addDangerToast]);
  useEffect(() => {
    refreshData();
  }, [refreshData]);
  const { rows, count, fetchData } = useMockListState<AlertRuleRecord>(alerts);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [alertBeingEdited, setAlertBeingEdited] =
    useState<AlertRuleRecord | null>(null);
  const [alertCurrentlyDeleting, setAlertCurrentlyDeleting] =
    useState<AlertRuleRecord | null>(null);

  const handleSave = useCallback(
    (input: Parameters<typeof createAlertRule>[0]) => {
      const save = alertBeingEdited
        ? updateAlertRule(alertBeingEdited.id, input, addDangerToast)
        : createAlertRule(input, addDangerToast);
      save.then(saved => {
        if (!saved) return; // error already toasted by data/alerts.ts
        setModalOpen(false);
        setAlertBeingEdited(null);
        refreshData();
        addSuccessToast(
          alertBeingEdited ? t('Alert updated') : t('Alert created'),
        );
      });
    },
    [alertBeingEdited, refreshData, addSuccessToast, addDangerToast],
  );

  const handleDeleteConfirm = useCallback(() => {
    if (!alertCurrentlyDeleting) return;
    deleteAlertRule(alertCurrentlyDeleting.id, addDangerToast).then(success => {
      if (!success) return;
      addSuccessToast(t('Deleted: %s', alertCurrentlyDeleting.name));
      setAlertCurrentlyDeleting(null);
      refreshData();
    });
  }, [alertCurrentlyDeleting, refreshData, addSuccessToast, addDangerToast]);

  const columns = useMemo(
    () => [
      { accessor: 'name', Header: t('Name'), id: 'name', size: 'xl' },
      {
        accessor: 'group_label',
        Header: t('Group'),
        id: 'group_label',
        size: 'lg',
      },
      {
        accessor: 'field_label',
        Header: t('Field'),
        id: 'field_label',
        size: 'lg',
      },
      {
        Cell: ({
          row: { original },
        }: {
          row: { original: AlertRuleRecord };
        }) =>
          original.trigger_type === 'condition'
            ? `${original.operator} ${original.value}`
            : '',
        Header: t('Condition'),
        id: 'condition',
        disableSortBy: true,
        size: 'md',
      },
      {
        Cell: ({ row: { original } }: { row: { original: AlertRuleRecord } }) =>
          original.event_definition_name ?? '',
        accessor: 'event_definition_name',
        Header: t('Incident'),
        id: 'event_definition_name',
        size: 'lg',
      },
      {
        Cell: ({
          row: { original },
        }: {
          row: { original: AlertRuleRecord };
        }) => (
          <Label type={SEVERITY_LABEL_TYPE[original.severity] ?? 'default'}>
            {original.severity}
          </Label>
        ),
        accessor: 'severity',
        Header: t('Severity'),
        id: 'severity',
        size: 'sm',
      },
      {
        Cell: ({
          row: { original },
        }: {
          row: { original: AlertRuleRecord };
        }) => (original.notify ? (original.recipient_name ?? '') : ''),
        accessor: 'recipient_name',
        Header: t('Recipient'),
        id: 'recipient_name',
        size: 'lg',
      },
      {
        accessor: 'updated_at',
        Header: t('Last modified'),
        id: 'updated_at',
        size: 'lg',
      },
      {
        Cell: ({
          row: { original },
        }: {
          row: { original: AlertRuleRecord };
        }) => {
          const actions: ListViewActionProps[] = [
            {
              label: 'edit-action',
              tooltip: t('Edit alert'),
              placement: 'bottom',
              icon: 'EditOutlined',
              onClick: () => {
                setAlertBeingEdited(original);
                setModalInstanceKey(key => key + 1);
                setModalOpen(true);
              },
            },
            {
              label: 'delete-action',
              tooltip: t('Delete alert'),
              placement: 'bottom',
              icon: 'DeleteOutlined',
              onClick: () => setAlertCurrentlyDeleting(original),
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
        Header: t('Severity'),
        key: 'severity',
        id: 'severity',
        input: 'select',
        operator: FilterOperator.Equals,
        unfilteredLabel: t('All'),
        selects: ['info', 'warning', 'critical'].map(severity => ({
          label: severity,
          value: severity,
        })),
      },
    ],
    [],
  );

  return (
    <>
      <SubMenu
        name={t('Alerts')}
        activeChild="Alert"
        tabs={actionMenuData.tabs}
        buttons={[
          {
            icon: <Icons.PlusOutlined iconSize="m" />,
            name: t('Alert'),
            onClick: () => {
              setAlertBeingEdited(null);
              setModalInstanceKey(key => key + 1);
              setModalOpen(true);
            },
            buttonStyle: 'primary',
          },
        ]}
      />
      <AlertModal
        key={modalInstanceKey}
        addDangerToast={addDangerToast}
        show={modalOpen}
        alertRule={alertBeingEdited}
        onHide={() => {
          setModalOpen(false);
          setAlertBeingEdited(null);
        }}
        onSave={handleSave}
      />
      {alertCurrentlyDeleting && (
        <DeleteModal
          description={t(
            'This will permanently remove this alert. This action cannot be undone.',
          )}
          onConfirm={handleDeleteConfirm}
          onHide={() => setAlertCurrentlyDeleting(null)}
          open
          title={t('Delete %s?', alertCurrentlyDeleting.name)}
        />
      )}
      <ListView<AlertRuleRecord>
        className="alert-list-view"
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

export default withToasts(ActionAlertList);
