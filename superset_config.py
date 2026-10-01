# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""Local development configuration for Webkorps Command Center.

Loaded via the SUPERSET_CONFIG_PATH environment variable (see .env.example).
All secrets and environment-specific values come from the process
environment - nothing sensitive is hardcoded here. See
DEVELOPMENT_SETUP.md for how to populate `.env`.
"""

import copy
import os


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            "Did you `cp .env.example .env` and source it? "
            "See DEVELOPMENT_SETUP.md."
        )
    return value


# --- Metadata database (PostgreSQL) ---
DATABASE_HOST = _require_env("DATABASE_HOST")
DATABASE_PORT = _require_env("DATABASE_PORT")
DATABASE_DB = _require_env("DATABASE_DB")
DATABASE_USER = _require_env("DATABASE_USER")
DATABASE_PASSWORD = _require_env("DATABASE_PASSWORD")

SQLALCHEMY_DATABASE_URI = (
    f"postgresql+psycopg2://{DATABASE_USER}:{DATABASE_PASSWORD}"
    f"@{DATABASE_HOST}:{DATABASE_PORT}/{DATABASE_DB}"
)

# --- Secret key ---
SECRET_KEY = _require_env("SUPERSET_SECRET_KEY")

# --- Redis (cache, Celery broker/results) ---
REDIS_HOST = _require_env("REDIS_HOST")
REDIS_PORT = int(_require_env("REDIS_PORT"))
REDIS_CELERY_BROKER_DB = int(os.environ.get("REDIS_CELERY_BROKER_DB", 1))
REDIS_CELERY_RESULTS_DB = int(os.environ.get("REDIS_CELERY_RESULTS_DB", 2))
REDIS_CACHE_DB = int(os.environ.get("REDIS_CACHE_DB", 3))


def _redis_cache_config(db: int) -> dict:
    return {
        "CACHE_TYPE": "RedisCache",
        "CACHE_DEFAULT_TIMEOUT": 300,
        "CACHE_KEY_PREFIX": "wkcc_",
        "CACHE_REDIS_HOST": REDIS_HOST,
        "CACHE_REDIS_PORT": REDIS_PORT,
        "CACHE_REDIS_DB": db,
    }


CACHE_CONFIG = _redis_cache_config(REDIS_CACHE_DB)
DATA_CACHE_CONFIG = _redis_cache_config(REDIS_CACHE_DB)
FILTER_STATE_CACHE_CONFIG = _redis_cache_config(REDIS_CACHE_DB)
EXPLORE_FORM_DATA_CACHE_CONFIG = _redis_cache_config(REDIS_CACHE_DB)


class CeleryConfig:
    broker_url = (
        f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_CELERY_BROKER_DB}"
    )
    result_backend = (
        f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_CELERY_RESULTS_DB}"
    )
    worker_prefetch_multiplier = 1
    task_acks_late = False


CELERY_CONFIG = CeleryConfig

# --- Misc dev settings ---
SUPERSET_ENV = os.environ.get("SUPERSET_ENV", "development")
ENABLE_PROXY_FIX = False

TALISMAN_ENABLED = True

# --- Branding: Webkorps Command Central ---
_BRAND_NAME = "Command Center"
_BRAND_LOGO_PATH = "/static/assets/images/command-central-logo.png"
# White-on-transparent variant for the green header bar - APP_ICON/FAVICONS
# below deliberately keep the original (a white icon would be invisible in
# a browser tab, which is nearly always a light background).
_BRAND_LOGO_WHITE_PATH = "/static/assets/images/command-central-logo-white.png"
# The dashboard clicking the header logo goes to, and the default landing
# dashboard after login (the latter is per-user - see
# scripts/set_welcome_dashboard.py, since Superset's welcome-dashboard
# redirect is a UserAttribute, not a static config value).
_DEFAULT_DASHBOARD_PATH = "/superset/dashboard/cc-network-health/"

APP_NAME = _BRAND_NAME
APP_ICON = _BRAND_LOGO_PATH
LOGO_TOOLTIP = _BRAND_NAME
LOGO_RIGHT_TEXT = _BRAND_NAME
FAVICONS = [{"href": _BRAND_LOGO_PATH}]

# The frontend renders the header logo from the `brandLogoUrl`/`brandAppName`
# *theme tokens* (falling back to APP_ICON/APP_NAME only when those tokens
# are unset), and THEME_DEFAULT/THEME_DARK below are already fully-formed
# dicts by the time this file loads - so APP_ICON/APP_NAME alone don't reach
# the header image. Rebrand both themes' tokens directly instead.
from superset.config import THEME_DARK as _DEFAULT_THEME_DARK  # noqa: E402
from superset.config import THEME_DEFAULT as _DEFAULT_THEME_DEFAULT  # noqa: E402


_BRAND_PRIMARY_COLOR = "#27AE60"

# A plain rotating-ring spinner instead of Superset's default two-circle
# mark. The rotation lives inside the SVG itself (animateTransform on the
# arc), never as a CSS transform on the <img> the Loading component
# renders this as - the Loading component's own `.floating` position
# centers via `transform: translate(-50%, -50%)`, and a second transform
# animated from the outside (e.g. a CSS @keyframes scale/rotate on the
# <img>) replaces rather than combines with it, breaking centering.
_BRAND_SPINNER_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">
  <circle cx="25" cy="25" r="20" fill="none" stroke="#e6f4ea" stroke-width="5"/>
  <circle cx="25" cy="25" r="20" fill="none" stroke="#27AE60" stroke-width="5"
    stroke-linecap="round" stroke-dasharray="31.4 94.2">
    <animateTransform attributeName="transform" type="rotate"
      from="0 25 25" to="360 25 25" dur="0.8s" repeatCount="indefinite"/>
  </circle>
</svg>"""


def _rebrand_theme(theme: dict | None) -> dict | None:
    if theme is None:
        return None
    branded = copy.deepcopy(theme)
    branded["token"]["brandAppName"] = _BRAND_NAME
    branded["token"]["brandLogoAlt"] = _BRAND_NAME
    branded["token"]["brandLogoUrl"] = _BRAND_LOGO_WHITE_PATH
    # Default (24px) reads as a small icon lost in the 63px-tall header bar.
    branded["token"]["brandLogoHeight"] = "36px"
    # Clicking the header logo goes straight to the default dashboard, not
    # the Dashboards list or the Home/Welcome page.
    branded["token"]["brandLogoHref"] = _DEFAULT_DASHBOARD_PATH
    branded["token"]["brandSpinnerSvg"] = _BRAND_SPINNER_SVG
    # Brand/action color. Semantic status tokens (colorError/colorWarning/
    # colorSuccess/colorInfo) are deliberately left untouched so the brand
    # color stays distinct from status colors - the AntD theme algorithm
    # derives every hover/active/border/bg shade of this from the one value.
    branded["token"]["colorPrimary"] = _BRAND_PRIMARY_COLOR
    branded["token"]["colorLink"] = _BRAND_PRIMARY_COLOR
    # "secondary" buttons (Cancel in every modal, plus any other
    # non-primary/non-destructive action) otherwise fall back to a pale
    # tint of colorPrimary - i.e. pale green, indistinguishable in intent
    # from Save/primary buttons. A neutral gray outline reads as "safe
    # no-op" instead, leaving colorError-based "danger" buttons as the only
    # red in the app for genuinely destructive actions (Delete, Discard).
    branded["token"]["buttonSecondaryColor"] = "rgba(0, 0, 0, 0.88)"
    branded["token"]["buttonSecondaryBg"] = "transparent"
    branded["token"]["buttonSecondaryBorderColor"] = "#d9d9d9"
    branded["token"]["buttonSecondaryHoverColor"] = "rgba(0, 0, 0, 0.88)"
    branded["token"]["buttonSecondaryHoverBg"] = "rgba(0, 0, 0, 0.04)"
    branded["token"]["buttonSecondaryHoverBorderColor"] = "#bfbfbf"
    branded["token"]["buttonSecondaryActiveColor"] = "rgba(0, 0, 0, 0.88)"
    branded["token"]["buttonSecondaryActiveBg"] = "rgba(0, 0, 0, 0.08)"
    branded["token"]["buttonSecondaryActiveBorderColor"] = "#8c8c8c"
    return branded


THEME_DEFAULT = _rebrand_theme(_DEFAULT_THEME_DEFAULT)
THEME_DARK = _rebrand_theme(_DEFAULT_THEME_DARK)

# --- CSP: allow the Command Center Rails API (separate origin) ---
# The frontend's Action tab (src/features/actions/data/*.ts) talks directly
# to a Rails API on a different origin. Without this, Talisman's CSP
# connect-src blocks those fetches even though the Rails side allows the
# request via CORS.
#
# COMMAND_CENTER_API_ORIGIN is the single source of truth for that origin -
# set it once in .env. webpack.config.js reads the same variable (via
# dotenv) and bakes it into src/features/actions/data/*.ts's
# COMMAND_CENTER_API_HOST, so the browser's CORS target and this CSP
# allowlist entry can never drift out of sync with each other.
from superset.config import TALISMAN_CONFIG as _DEFAULT_TALISMAN_CONFIG  # noqa: E402
from superset.config import (  # noqa: E402
    TALISMAN_DEV_CONFIG as _DEFAULT_TALISMAN_DEV_CONFIG,
)

_COMMAND_CENTER_API_ORIGIN = os.environ.get(
    "COMMAND_CENTER_API_ORIGIN", "http://182.156.33.77:9012"
)


def _allow_command_center_origin(talisman_config: dict) -> dict:
    config = copy.deepcopy(talisman_config)
    config["content_security_policy"]["connect-src"].append(
        _COMMAND_CENTER_API_ORIGIN
    )
    return config


TALISMAN_CONFIG = _allow_command_center_origin(_DEFAULT_TALISMAN_CONFIG)
TALISMAN_DEV_CONFIG = _allow_command_center_origin(_DEFAULT_TALISMAN_DEV_CONFIG)

# --- Chart-scoped AI chat (superset/chart_chat) ---
# Unlike the Action tab's direct browser->Rails calls above, chart chat is
# proxied through Superset so the chart's dataset is resolved and access-checked
# here before any context reaches the AI service. This URL is therefore used
# server-side, not by the browser.
COMMAND_CENTER_API_URL = _COMMAND_CENTER_API_ORIGIN
# Shared secret proving a chart-chat request came from Superset post-auth.
# Set COMMAND_CENTER_SERVICE_TOKEN in the environment on both sides; never
# commit a value here.
COMMAND_CENTER_SERVICE_TOKEN = os.environ.get("COMMAND_CENTER_SERVICE_TOKEN")
