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
import { useState, useEffect } from 'react';
import { t } from '@apache-superset/core/translation';
import { styled, css, useTheme } from '@apache-superset/core/theme';
import { ensureStaticPrefix } from 'src/utils/assetUrl';
import { ensureAppRoot } from 'src/utils/pathUtils';
import { getUrlParam } from 'src/utils/urlUtils';
import { MainNav, MenuItem } from '@superset-ui/core/components/Menu';
import { Tooltip, Grid, Row, Col, Image } from '@superset-ui/core/components';
import { GenericLink } from 'src/components';
import { NavLink, useLocation } from 'react-router-dom';
import { Icons } from '@superset-ui/core/components/Icons';
import { Typography } from '@superset-ui/core/components/Typography';
import { useUiConfig } from 'src/components/UiConfigContext';
import { URL_PARAMS } from 'src/constants';
import {
  MenuObjectChildProps,
  MenuObjectProps,
  MenuData,
} from 'src/types/bootstrapTypes';
import RightMenu from './RightMenu';
import { NAVBAR_MENU_POPUP_OFFSET } from './commonMenuData';
import {
  ACTION_ALERT_PATH,
  ACTION_EVENT_PATH,
  ACTION_INTEGRATION_PATH,
} from './actionMenuData';

// Static, not sourced from Superset's own `brand` bootstrap data (which
// only carries a single title string) - describes what this fork of
// Superset actually is, per ARCHITECTURE.md: operational master data,
// real-time event stream, and alert/notification engine.
const BRAND_SUBTITLE = t('Business Operations Platform');

interface MenuProps {
  data: MenuData;
  isFrontendRoute?: (path?: string) => boolean;
}

// A compact header height (antd's own Menu item height token otherwise
// drives this to 72px, which reads as oversized next to this app's other
// chrome - see the matching .ant-menu-item override below).
const HEADER_HEIGHT = 60;

const StyledHeader = styled.header`
  ${({ theme }) => css`
    background-color: ${theme.colorPrimary};
    color: ${theme.colorWhite};
    height: ${HEADER_HEIGHT}px;
    padding: 0 ${theme.sizeUnit * 4}px;
    z-index: 10;

    &:nth-last-of-type(2) nav {
      margin-bottom: 2px;
    }

    .caret {
      display: none;
    }

    /* Solid brand-color header bar (matches the reference site's nav
       treatment): everything that isn't a self-contained badge/button
       inherits white text/icon color from here instead of the app's
       default dark-on-white nav styling. */
    a,
    .anticon {
      color: ${theme.colorWhite};
    }

    /* buttonStyle="primary" renders a colorPrimary-filled button, which
       would be invisible on a colorPrimary header - invert to a white
       outline instead so it still reads as a button here. */
    /* The outline look is kept in every state - the interaction states
       are restated explicitly so antd's own primary hover/active fill
       can't win on rule order. */
    .ant-btn.ant-btn-primary:not(:disabled) {
      &,
      &:hover,
      &:active,
      &:focus,
      &:focus-visible {
        background-color: transparent;
        border-color: ${theme.colorWhite};
        color: ${theme.colorWhite};
        box-shadow: none;
      }

      &:focus-visible {
        outline: 2px solid ${theme.colorWhite};
        outline-offset: 2px;
      }

      .anticon {
        color: inherit;
      }
    }
  `}
`;

const StyledBrandText = styled.div`
  ${({ theme }) => css`
    height: 100%;
    color: ${theme.colorWhite};
    /* No padding-left here - StyledCol's own flex gap already spaces
       this from the logo; adding padding on top of that gap was doubling
       up the visual distance between them. padding-right is kept, to
       still space this from the nav that follows it. */
    padding-right: ${theme.sizeUnit * 4}px;
    float: left;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;

    span {
      max-width: ${theme.sizeUnit * 58}px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .brand-title {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.2;
    }

    .brand-subtitle {
      font-size: 11px;
      font-weight: 400;
      line-height: 1.2;
      /* Muted via opacity rather than a second color token/literal -
         stays tied to the same white used by the title above it. */
      opacity: 0.75;
    }

    @media (max-width: 1127px) {
      display: none;
    }
  `}
`;

const StyledMainNav = styled(MainNav)`
  ${({ theme }) => css`
    /* Allow the nav to actually shrink within its flex row instead of
       forcing siblings (brand text, right-side controls) to overlap or
       wrap - flex items default to a content-based min-width otherwise. */
    flex: 1 1 auto;
    min-width: 0;
    background: transparent;

    .ant-menu-item .ant-menu-item-icon + span,
    .ant-menu-submenu-title .ant-menu-item-icon + span,
    .ant-menu-item .anticon + span,
    .ant-menu-submenu-title .anticon + span {
      margin-inline-start: 0;
    }

    /* On the solid brand-color header, every item reads as translucent
       white by default and solid white on hover/active - mirrors the
       reference site's nav (white text directly on a green bar), rather
       than this app's usual white-bg/green-accent convention. */
    &.ant-menu-horizontal {
      background: transparent;
      border-bottom: none;
    }

    /* antd's own default item height (72px) is taller than this header -
       plain (non-submenu) top-level items don't inherit the header's
       height the way flex/percentage-sized elements would, since antd
       sets it as a fixed token value. The submenu-horizontal block below
       already overrides its own title's height via calc(100%, ...); this
       does the equivalent for plain items so both match the header. */
    &.ant-menu-horizontal > .ant-menu-item {
      height: ${HEADER_HEIGHT}px !important;
      line-height: ${HEADER_HEIGHT}px !important;
    }

    .ant-menu-item,
    .ant-menu-submenu-title,
    .ant-menu-title-content {
      color: ${theme.colorTextLightSolid};
    }

    .ant-menu-item:hover,
    .ant-menu-item-selected,
    .ant-menu-item-active {
      color: ${theme.colorTextLightSolid} !important;
      font-weight: ${theme.fontWeightStrong};
    }

    .ant-menu-item::after {
      border-bottom-color: ${theme.colorWhite} !important;
    }

    .ant-menu-submenu.ant-menu-submenu-horizontal {
      display: flex;
      align-items: center;
      height: 100%;
      padding: 0;

      .ant-menu-submenu-title {
        display: flex;
        gap: ${theme.sizeUnit * 2}px;
        flex-direction: row-reverse;
        align-items: center;
        height: calc(100% - ${theme.sizeUnit * 3}px);
        margin: ${theme.sizeUnit * 1.5}px 0;
        padding: 0 ${theme.sizeUnit * 4}px;
        border-radius: ${theme.borderRadius}px;
        transition: background-color 0.2s ease-out;
      }

      /* Same "highlighted pill" treatment already used for the active item
         in the mobile inline menu - a background tint is robust against
         antd's own internal selected/hover styles in a way a border or
         custom ::after here has proven not to be. */
      &:hover .ant-menu-submenu-title,
      &.ant-menu-submenu-active .ant-menu-submenu-title,
      &.ant-menu-submenu-open .ant-menu-submenu-title,
      &.ant-menu-submenu-selected .ant-menu-submenu-title {
        background-color: rgb(from ${theme.colorWhite} r g b / 0.16);
      }

      &:hover,
      &.ant-menu-submenu-active,
      &.ant-menu-submenu-open,
      &.ant-menu-submenu-selected {
        .ant-menu-title-content {
          color: ${theme.colorWhite};
        }
      }
    }
  `}
`;

const StyledBrandWrapper = styled.div<{ margin?: string }>`
  ${({ margin }) => css`
    height: ${margin ? 'auto' : '100%'};
    margin: ${margin ?? 0};
  `}
`;

const StyledBrandLink = styled(Typography.Link)`
  ${({ theme }) => css`
    align-items: center;
    display: flex;
    height: 100%;
    justify-content: center;

    &:focus {
      border-color: transparent;
    }

    &:focus-visible {
      border-color: ${theme.colorPrimaryText};
    }
  `}
`;

const StyledRow = styled(Row)`
  height: 100%;
`;

const StyledCol = styled(Col)`
  ${({ theme }) => css`
    /* An explicit height, not reliance on the parent Row's flex-stretch -
       antd's Row/Col still leaves this at its tallest child's natural
       content height otherwise (observed: antd Menu's own items want more
       height than this header's content needs), which then cascades back
       down through every descendant's height:100%/calc(100%, ...) rule. */
    height: 100%;
    display: flex;
    gap: ${theme.sizeUnit * 4}px;
    flex-wrap: wrap;

    /* The brand Tooltip wraps renderBrand()'s Fragment in its own plain
       <span> (antd can't attach a ref to a Fragment directly), which isn't
       a flex item styled by us and doesn't stretch to this row's height on
       its own - force it to, and center its content, so the logo lines up
       vertically with the nav/right-side controls instead of sitting at
       its own unrelated natural content height. */
    > span {
      display: flex;
      align-items: center;
      height: 100%;
    }
  `}
`;

const StyledImage = styled(Image)`
  object-fit: contain;
`;

const { useBreakpoint } = Grid;

export function Menu({
  data: {
    menu,
    brand,
    navbar_right: navbarRight,
    settings,
    environment_tag: environmentTag,
  },
  isFrontendRoute = () => false,
}: MenuProps) {
  const screens = useBreakpoint();
  const uiConfig = useUiConfig();
  const theme = useTheme();

  enum Paths {
    Explore = '/explore',
    Dashboard = '/dashboard',
    Chart = '/chart',
    Datasets = '/tablemodelview',
    SqlLab = '/sqllab',
    SavedQueries = '/savedqueryview',
    Integration = '/integration',
    Event = '/event',
    Alert = '/action-alert',
  }

  const defaultTabSelection: string[] = [];
  const [activeTabs, setActiveTabs] = useState(defaultTabSelection);
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname;
    switch (true) {
      case path.startsWith(Paths.Dashboard):
        setActiveTabs(['Dashboards']);
        break;
      case path.startsWith(Paths.Chart) || path.startsWith(Paths.Explore):
        setActiveTabs(['Charts']);
        break;
      case path.startsWith(Paths.Datasets):
        setActiveTabs(['Datasets']);
        break;
      case path.startsWith(Paths.SqlLab) || path.startsWith(Paths.SavedQueries):
        setActiveTabs(['SQL']);
        break;
      case path.startsWith(Paths.Integration) ||
        path.startsWith(Paths.Event) ||
        path.startsWith(Paths.Alert):
        setActiveTabs(['Action']);
        break;
      default:
        setActiveTabs(defaultTabSelection);
    }
  }, [location.pathname]);

  const standalone = getUrlParam(URL_PARAMS.standalone);
  if (standalone || uiConfig.hideNav) return <></>;

  const buildMenuItem = ({
    label,
    childs,
    url,
    isFrontendRoute,
  }: MenuObjectProps): MenuItem => {
    if (url && isFrontendRoute) {
      return {
        key: label,
        label: (
          <NavLink role="button" to={url} activeClassName="is-active">
            {label}
          </NavLink>
        ),
      };
    }

    if (url) {
      return {
        key: label,
        label: <Typography.Link href={url}>{label}</Typography.Link>,
      };
    }

    const childItems: MenuItem[] = [];
    childs?.forEach((child: MenuObjectChildProps | string, index1: number) => {
      if (typeof child === 'string' && child === '-' && label !== 'Data') {
        childItems.push({ type: 'divider', key: `divider-${index1}` });
      } else if (typeof child !== 'string') {
        childItems.push({
          key: `${child.label}`,
          label: child.isFrontendRoute ? (
            <NavLink to={child.url || ''} exact activeClassName="is-active">
              {child.label}
            </NavLink>
          ) : (
            <Typography.Link href={child.url}>{child.label}</Typography.Link>
          ),
        });
      }
    });

    return {
      key: label,
      label,
      ...(screens.md && {
        icon: <Icons.DownOutlined iconSize="xs" />,
        popupOffset: NAVBAR_MENU_POPUP_OFFSET,
      }),
      children: childItems,
    };
  };
  const renderBrand = () => {
    let link;
    if (theme.brandLogoUrl) {
      link = (
        <StyledBrandWrapper margin={theme.brandLogoMargin}>
          <StyledBrandLink href={ensureAppRoot(theme.brandLogoHref)}>
            <StyledImage
              preview={false}
              src={ensureStaticPrefix(theme.brandLogoUrl)}
              alt={theme.brandLogoAlt || 'Apache Superset'}
              height={theme.brandLogoHeight}
            />
          </StyledBrandLink>
        </StyledBrandWrapper>
      );
    } else if (isFrontendRoute(window.location.pathname)) {
      // ---------------------------------------------------------------------------------
      // TODO: deprecate this once Theme is fully rolled out
      // Kept as is for backwards compatibility with the old theme system / superset_config.py
      link = (
        <GenericLink className="navbar-brand" to={brand.path}>
          <StyledImage
            preview={false}
            src={ensureStaticPrefix(brand.icon)}
            alt={brand.alt}
          />
        </GenericLink>
      );
    } else {
      link = (
        <Typography.Link
          className="navbar-brand"
          href={ensureAppRoot(brand.path)}
          tabIndex={-1}
        >
          <StyledImage
            preview={false}
            src={ensureStaticPrefix(brand.icon)}
            alt={brand.alt}
          />
        </Typography.Link>
      );
    }
    // ---------------------------------------------------------------------------------
    return <>{link}</>;
  };
  return (
    <StyledHeader className="top" id="main-menu" role="navigation">
      <StyledRow align="stretch">
        <StyledCol md={16} xs={24}>
          <Tooltip
            id="brand-tooltip"
            placement="bottomLeft"
            title={brand.tooltip}
            arrow={{ pointAtCenter: true }}
          >
            {renderBrand()}
          </Tooltip>
          {brand.text && (
            <StyledBrandText>
              <span className="brand-title">{brand.text}</span>
              <span className="brand-subtitle">{BRAND_SUBTITLE}</span>
            </StyledBrandText>
          )}
          <StyledMainNav
            mode={screens.md ? 'horizontal' : 'inline'}
            data-test="navbar-top"
            className="main-nav"
            selectedKeys={activeTabs}
            items={menu.map(item => {
              const props = {
                ...item,
                isFrontendRoute: isFrontendRoute(item.url),
                childs: item.childs?.map(c => {
                  if (typeof c === 'string') {
                    return c;
                  }

                  return {
                    ...c,
                    isFrontendRoute: isFrontendRoute(c.url),
                  };
                }),
              };

              return buildMenuItem(props);
            })}
          />
        </StyledCol>
        <Col md={8} xs={24}>
          <RightMenu
            align={screens.md ? 'flex-end' : 'flex-start'}
            settings={settings}
            navbarRight={navbarRight}
            isFrontendRoute={isFrontendRoute}
            environmentTag={environmentTag}
          />
        </Col>
      </StyledRow>
    </StyledHeader>
  );
}

// transform the menu data to reorganize components
export default function MenuWrapper({ data, ...rest }: MenuProps) {
  const newMenuData = {
    ...data,
  };
  // Menu items that should go into settings dropdown
  const settingsMenus = {
    Data: true,
    Security: true,
    Manage: true,
  };

  // Cycle through menu.menu to build out cleanedMenu and settings
  const cleanedMenu: MenuObjectProps[] = [];
  const settings: MenuObjectProps[] = [];
  newMenuData.menu.forEach((item: any) => {
    if (!item) {
      return;
    }

    const children: (MenuObjectProps | string)[] = [];
    const newItem = {
      ...item,
    };

    // Filter childs
    if (item.childs) {
      item.childs.forEach((child: MenuObjectChildProps | string) => {
        if (typeof child === 'string') {
          children.push(child);
        } else if ((child as MenuObjectChildProps).label) {
          children.push(child);
        }
      });

      newItem.childs = children;
    }

    if (!settingsMenus.hasOwnProperty(item.name)) {
      cleanedMenu.push(newItem);
    } else {
      settings.push(newItem);
    }
  });

  // Insert the "Action" tab (Integration/Event/Alert) beside the SQL tab.
  // This is added client-side, rather than via the backend menu config,
  // so it stays isolated from the existing SQL/Dataset menu wiring. Like
  // every other tab, it must only show once the user is logged in -
  // gate it the same way RightMenu.tsx gates its own items.
  if (!newMenuData.navbar_right.user_is_anonymous) {
    const actionMenuItem: MenuObjectProps = {
      name: 'Actions',
      label: t('Action'),
      childs: [
        {
          name: 'Integration',
          label: t('Integration'),
          url: ACTION_INTEGRATION_PATH,
        },
        { name: 'Event', label: t('Incident'), url: ACTION_EVENT_PATH },
        { name: 'Alert', label: t('Alert Rule'), url: ACTION_ALERT_PATH },
      ],
    };
    const sqlMenuIndex = cleanedMenu.findIndex(item => item.label === 'SQL');
    const insertAt =
      sqlMenuIndex === -1 ? cleanedMenu.length : sqlMenuIndex + 1;
    cleanedMenu.splice(insertAt, 0, actionMenuItem);
  }

  newMenuData.menu = cleanedMenu;
  newMenuData.settings = settings;

  return <Menu data={newMenuData} {...rest} />;
}
