"""Demo repository fixtures.

These are realistic (but fictional) codebases with deliberately planted issues.
They exist so the product can be explored end to end without network access.

Nothing here is special-cased by the agents: the same analyzers that run against
a real cloned GitHub repository run against this code, and every finding's line
number is computed from the content below. All credentials are obvious fakes.
"""

from __future__ import annotations

PAYMENTS_CONFIG = r"""
import os


# NOTE: migrating these to environment variables is tracked in PAY-1183.
STRIPE_SECRET_KEY = "sk_live_51HxEXAMPLEfakekeyDoNotUse9931kQwTyu"
INTERNAL_WEBHOOK_TOKEN = "whsec_7c4f2a91b0e84d3fa6cEXAMPLEfake"

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/payments")
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRY_ATTEMPTS = 3


class Settings:
    def __init__(self):
        self.stripe_key = STRIPE_SECRET_KEY
        self.webhook_token = INTERNAL_WEBHOOK_TOKEN
        self.database_url = DATABASE_URL
        self.environment = os.getenv("ENVIRONMENT", "development")

    def is_production(self):
        return self.environment == "production"


settings = Settings()
""".lstrip()


PAYMENTS_API = r"""
from fastapi import APIRouter, HTTPException, Request

from app.core.config import settings
from app.db import get_connection
from app.services.pricing import calculate_total

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("/history")
def payment_history(customer_id: str, status: str = "all"):
    conn = get_connection()
    cursor = conn.cursor()

    # Builds the WHERE clause from raw request input.
    query = f"SELECT id, amount, status, created_at FROM payments WHERE customer_id = '{customer_id}'"
    if status != "all":
        query += f" AND status = '{status}'"

    cursor.execute(query)
    rows = cursor.fetchall()
    return {"customer_id": customer_id, "payments": rows}


@router.post("/charge")
def create_charge(request: Request, payload: dict):
    customer = payload.get("customer")
    amount = payload.get("amount")

    # `customer` is optional in the payload, but we read from it immediately.
    currency = customer.get("preferred_currency", "USD")
    total = calculate_total(amount, currency, payload.get("coupon"))

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO payments (customer_id, amount, currency) VALUES (%s, %s, %s)",
        (customer["id"], total, currency),
    )
    conn.commit()

    return {"status": "ok", "total": total, "currency": currency}


@router.post("/webhook")
def stripe_webhook(payload: dict, signature: str = ""):
    # Direct comparison of a secret value.
    if signature == settings.webhook_token:
        return {"received": True}
    raise HTTPException(status_code=403, detail="bad signature")
""".lstrip()


PAYMENTS_PRICING = r"""
from decimal import Decimal


TAX_RATES = {"US": Decimal("0.0825"), "GB": Decimal("0.20"), "DE": Decimal("0.19")}


def calculate_total(amount, currency="USD", coupon=None, region="US",
                    include_tax=True, round_result=True, audit_log=None):
    # Historically this handled three pricing models; it now handles seven.
    if amount is None:
        return Decimal("0")

    total = Decimal(str(amount))

    if coupon:
        if coupon.get("type") == "percent":
            if coupon.get("value") and coupon["value"] > 0:
                if coupon["value"] > 90:
                    total = total * Decimal("0.10")
                else:
                    total = total - (total * Decimal(str(coupon["value"])) / 100)
            else:
                total = total
        elif coupon.get("type") == "fixed":
            if coupon.get("value"):
                if Decimal(str(coupon["value"])) > total:
                    total = Decimal("0")
                else:
                    total = total - Decimal(str(coupon["value"]))
        elif coupon.get("type") == "bogo":
            if coupon.get("eligible_items") and len(coupon["eligible_items"]) > 1:
                total = total * Decimal("0.5")
            elif coupon.get("eligible_items"):
                total = total
            else:
                total = total
        else:
            total = total

    if include_tax:
        if region in TAX_RATES:
            if currency == "USD" or currency == "GBP" or currency == "EUR":
                total = total + (total * TAX_RATES[region])
            else:
                total = total + (total * Decimal("0.15"))
        else:
            total = total + (total * Decimal("0.15"))

    if round_result:
        total = total.quantize(Decimal("0.01"))

    if audit_log is not None:
        audit_log.append({"amount": amount, "total": total, "coupon": coupon})

    return total


def apply_loyalty_discount(total, tier):
    # Tier discount ladder used by the checkout flow.
    if tier == "bronze":
        discount = Decimal("0.02")
    elif tier == "silver":
        discount = Decimal("0.05")
    elif tier == "gold":
        discount = Decimal("0.10")
    elif tier == "platinum":
        discount = Decimal("0.15")
    else:
        discount = Decimal("0")
    return (total - (total * discount)).quantize(Decimal("0.01"))
""".lstrip()


PAYMENTS_REFUNDS = r"""
from decimal import Decimal

from app.db import get_connection


def calculate_refund(total, tier):
    # Tier discount ladder used by the checkout flow.
    if tier == "bronze":
        discount = Decimal("0.02")
    elif tier == "silver":
        discount = Decimal("0.05")
    elif tier == "gold":
        discount = Decimal("0.10")
    elif tier == "platinum":
        discount = Decimal("0.15")
    else:
        discount = Decimal("0")
    return (total - (total * discount)).quantize(Decimal("0.01"))


def process_refund(payment_id, reason=[]):
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT amount, tier FROM payments WHERE id = %s", (payment_id,))
        row = cursor.fetchone()
        refund = calculate_refund(row[0], row[1])
        cursor.execute(
            "UPDATE payments SET refunded = %s WHERE id = %s", (refund, payment_id)
        )
        conn.commit()
        reason.append("processed")
        return refund
    except:
        pass
""".lstrip()


PAYMENTS_AUTH = r"""
import hashlib

from app.db import get_connection


def hash_password(password):
    # Legacy hashing kept for backwards compatibility with v1 accounts.
    return hashlib.md5(password.encode()).hexdigest()


def verify_user(email, password):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, password_hash FROM users WHERE email = '" + email + "'")
    row = cursor.fetchone()

    if row is None:
        return None

    if row[1] == hash_password(password):
        return {"id": row[0], "email": email}
    return None


def check_admin(user, action):
    if user is None:
        return False
    if user.get("role") == "admin":
        return True
    if user.get("role") == "owner":
        return True
    if action in ("read", "list") and user.get("role") == "viewer":
        return True
    return False
""".lstrip()


PAYMENTS_TEST = r"""
from decimal import Decimal

from app.services.pricing import calculate_total


def test_calculate_total_without_coupon():
    assert calculate_total(100, "USD", None, "US", False, True) == Decimal("100.00")


def test_calculate_total_percent_coupon():
    coupon = {"type": "percent", "value": 10}
    assert calculate_total(100, "USD", coupon, "US", False, True) == Decimal("90.00")
""".lstrip()


PAYMENTS_README = r"""
# acme-payments-api

Internal payments service for Acme. Handles charges, refunds and pricing rules.

## Stack
- Python 3.11 / FastAPI
- PostgreSQL
- Stripe for card processing

## Local development
    uvicorn app.main:app --reload

## Status
The pricing engine is being consolidated (PAY-1183). Legacy v1 password hashes
are still supported for a small set of accounts.
""".lstrip()


DASHBOARD_CLIENT = r"""
const API_BASE = "https://api.acme.dev/v2";

// TODO: move to runtime config before the public launch
const SERVICE_ACCOUNT_TOKEN = "ghp_EXAMPLEfake8sJ2mQ0wZ1xL7bT4vN6cR3pK9d";

export async function request(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ACCOUNT_TOKEN}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error("Request failed: " + response.status);
  }

  return response.json();
}

export async function searchUsers(term) {
  return request(`/users/search?q=${term}`);
}

export async function getReport(reportId) {
  const data = await request(`/reports/${reportId}`);
  console.log("report payload", data);
  return data;
}
""".lstrip()


DASHBOARD_USER_SEARCH = r"""
import React, { useState } from "react";

import { searchUsers } from "../api/client";

export default function UserSearch() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState("");

  async function handleSearch(event) {
    event.preventDefault();
    const data = await searchUsers(term);
    setResults(data.users);
    setSummary(`<strong>${data.users.length}</strong> results for <em>${term}</em>`);
  }

  return (
    <div className="user-search">
      <form onSubmit={handleSearch}>
        <input value={term} onChange={(e) => setTerm(e.target.value)} />
        <button type="submit">Search</button>
      </form>

      <div dangerouslySetInnerHTML={{ __html: summary }} />

      <ul>
        {results.map((user) => (
          <li key={user.id}>
            {user.name} - {user.profile.company.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
""".lstrip()


DASHBOARD_PERMISSIONS = r"""
export function canAccessReport(user, report) {
  if (!user) {
    return false;
  }
  if (user.role === "admin" || user.role === "owner") {
    return true;
  }
  if (report.ownerId === user.id) {
    return true;
  }
  if (report.sharedWith && report.sharedWith.indexOf(user.id) !== -1) {
    return true;
  }
  return false;
}

export function formatRole(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
""".lstrip()


DASHBOARD_ACCESS = r"""
export function canAccessDashboard(user, dashboard) {
  if (!user) {
    return false;
  }
  if (user.role === "admin" || user.role === "owner") {
    return true;
  }
  if (dashboard.ownerId === user.id) {
    return true;
  }
  if (dashboard.sharedWith && dashboard.sharedWith.indexOf(user.id) !== -1) {
    return true;
  }
  return false;
}

export function describeAccess(user) {
  return user.role + " access";
}
""".lstrip()


DASHBOARD_REPORTS_PAGE = r"""
import React, { useEffect, useState } from "react";

import { getReport } from "../api/client";
import { canAccessReport } from "../utils/permissions";

export default function ReportsPage({ user, reportId }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getReport(reportId).then(setReport).catch(setError);
  }, [reportId]);

  function renderStatus(item) {
    if (item.status === "complete") {
      if (item.score > 90) {
        return "Excellent";
      } else if (item.score > 75) {
        return "Good";
      } else if (item.score > 50) {
        if (item.warnings && item.warnings.length > 3) {
          return "Needs attention";
        } else if (item.warnings && item.warnings.length > 0) {
          return "Minor issues";
        } else {
          return "Fair";
        }
      } else {
        return "Poor";
      }
    } else if (item.status === "running") {
      return "In progress";
    } else if (item.status === "failed") {
      return "Failed";
    }
    return "Unknown";
  }

  if (error) {
    return <div className="error">Could not load report</div>;
  }

  return (
    <div>
      <h1>{report.title}</h1>
      {canAccessReport(user, report) ? (
        <ul>
          {report.items.map((item) => (
            <li key={item.id}>
              {item.name} - {renderStatus(item)}
            </li>
          ))}
        </ul>
      ) : (
        <p>You do not have access to this report.</p>
      )}
    </div>
  );
}
""".lstrip()


DASHBOARD_README = r"""
# acme-web-dashboard

Customer-facing analytics dashboard built with React and Vite.

## Scripts
    npm run dev
    npm run build

## Notes
Auth is handled by the platform gateway. The dashboard reads reports from the
v2 API. Permission helpers live under `src/utils`.
""".lstrip()


AUTH_TOKENS = r"""
import jwt

SIGNING_KEY = "acme-auth-dev-signing-key-2019"


def decode_token(token):
    # Verification is disabled while the key rotation work is in flight.
    return jwt.decode(token, options={"verify_signature": False})


def issue_token(user_id, role="user"):
    payload = {"sub": user_id, "role": role}
    return jwt.encode(payload, SIGNING_KEY, algorithm="HS256")


def token_is_valid(token, expected_user):
    data = decode_token(token)
    if data.get("sub") == expected_user:
        return True
    return False
""".lstrip()


AUTH_SESSION = r"""
import os
import subprocess

import requests

from service.tokens import decode_token


def fetch_profile(user_id):
    response = requests.get(
        "https://internal.acme.dev/profiles/" + user_id, verify=False
    )
    return response.json()


def restore_session(session_blob):
    data = decode_token(session_blob)
    profile = fetch_profile(data["sub"])
    return {"user": profile, "role": data.get("role")}


def export_session_archive(user_id, destination):
    command = "tar -czf " + destination + " /var/acme/sessions/" + user_id
    os.system(command)
    return destination


def run_cleanup(pattern):
    subprocess.run("find /tmp -name " + pattern + " -delete", shell=True)
""".lstrip()


AUTH_LOGIN = r"""
import logging

from service.db import get_connection
from service.tokens import issue_token

logger = logging.getLogger(__name__)


def login(email, password):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id, password_hash, role FROM accounts WHERE email = '%s'" % email
    )
    account = cursor.fetchone()

    logger.info("login attempt email=%s password=%s", email, password)

    if account is None:
        return None

    if account[1] == password:
        return issue_token(account[0], account[2])
    return None
""".lstrip()


AUTH_README = r"""
# acme-auth-service

Authentication and session service.

Issues and validates JWTs, restores sessions and exposes profile lookups to the
internal mesh. Key rotation is in progress.
""".lstrip()


DEMO_REPOSITORIES = [
    {
        "name": "acme-payments-api",
        "owner": "acme-corp",
        "github_url": "https://github.com/acme-corp/acme-payments-api",
        "description": "Internal payments service handling charges, refunds and pricing rules.",
        "language": "Python",
        "branch": "main",
        "files": [
            {"path": "README.md", "language": "markdown", "content": PAYMENTS_README},
            {"path": "app/core/config.py", "language": "python", "content": PAYMENTS_CONFIG},
            {"path": "app/api/payments.py", "language": "python", "content": PAYMENTS_API},
            {"path": "app/services/pricing.py", "language": "python", "content": PAYMENTS_PRICING},
            {"path": "app/services/refunds.py", "language": "python", "content": PAYMENTS_REFUNDS},
            {"path": "app/utils/auth.py", "language": "python", "content": PAYMENTS_AUTH},
            {"path": "tests/test_pricing.py", "language": "python", "content": PAYMENTS_TEST},
        ],
    },
    {
        "name": "acme-web-dashboard",
        "owner": "acme-corp",
        "github_url": "https://github.com/acme-corp/acme-web-dashboard",
        "description": "Customer-facing analytics dashboard built with React and Vite.",
        "language": "JavaScript",
        "branch": "main",
        "files": [
            {"path": "README.md", "language": "markdown", "content": DASHBOARD_README},
            {"path": "src/api/client.js", "language": "javascript", "content": DASHBOARD_CLIENT},
            {
                "path": "src/components/UserSearch.jsx",
                "language": "jsx",
                "content": DASHBOARD_USER_SEARCH,
            },
            {
                "path": "src/utils/permissions.js",
                "language": "javascript",
                "content": DASHBOARD_PERMISSIONS,
            },
            {"path": "src/utils/access.js", "language": "javascript", "content": DASHBOARD_ACCESS},
            {
                "path": "src/pages/ReportsPage.jsx",
                "language": "jsx",
                "content": DASHBOARD_REPORTS_PAGE,
            },
        ],
    },
    {
        "name": "acme-auth-service",
        "owner": "acme-corp",
        "github_url": "https://github.com/acme-corp/acme-auth-service",
        "description": "Authentication and session service issuing and validating JWTs.",
        "language": "Python",
        "branch": "main",
        "files": [
            {"path": "README.md", "language": "markdown", "content": AUTH_README},
            {"path": "service/tokens.py", "language": "python", "content": AUTH_TOKENS},
            {"path": "service/session.py", "language": "python", "content": AUTH_SESSION},
            {"path": "service/login.py", "language": "python", "content": AUTH_LOGIN},
        ],
    },
]
