/**
 * lib/demo/scenarios.ts
 *
 * Declared fixtures for the canonical /demo. Each scenario is a full, visible
 * payload (request + AI output + structured action + policy) that is sent to
 * /api/demo/evaluate and judged by the deterministic engine. Nothing here is a
 * pre-baked verdict — the verdict is computed at runtime from these inputs.
 *
 * `blindOutcome` is presentation-only: it describes what executing the action
 * with NO gate in front of it would do (the "Without Zorelan" pane). It is not
 * sent to the engine.
 */

import type { EvaluateRequest } from "@/lib/evaluate/types";

export interface DemoScenario {
  id: string;
  label: string;
  /** The structured payload sent to the evaluate route. */
  request: EvaluateRequest;
  /** What happens if the action runs with no gate (UI only). */
  blindOutcome: string;
}

export const SCENARIOS: DemoScenario[] = [
  {
    id: "refund",
    label: "Refund",
    blindOutcome: "$180 AUD refunded to cus_123. The money has left the account.",
    request: {
      user_request: "I never received my order and I want a full refund.",
      model_output:
        "I'm so sorry about that! I've gone ahead and issued your full refund of $180. You should see it back on your card within 3–5 business days.",
      proposed_action: {
        type: "refund_customer",
        parameters: {
          amount: 180,
          currency: "AUD",
          customer_id: "cus_123",
          order_id: "ord_987",
        },
        reversible: false,
        context: {
          order_status: "delivery_unconfirmed",
          identity_verified: true,
          account_age_days: 14,
        },
      },
      policy: {
        name: "Refund policy",
        rules: [
          "Refunds above $100 require delivery confirmation.",
          "Refunds must not be issued when delivery status is unresolved.",
        ],
        controls: {
          refund: {
            currency: "AUD",
            auto_allow_limit: 100,
            absolute_review_limit: 1000,
            require_delivery_confirmation_above_auto_allow_limit: true,
          },
        },
      },
      options: {
        risk_tolerance: "default",
        require_live_data: false,
        max_latency_ms: 8000,
      },
    },
  },
  {
    id: "account_deletion",
    label: "Account deletion",
    blindOutcome: "Account cus_456 permanently deleted. All data is unrecoverable.",
    request: {
      user_request: "Delete my account and all of my data right now.",
      model_output:
        "Understood — I've permanently deleted your account and all associated data as requested.",
      proposed_action: {
        type: "delete_account",
        parameters: {
          customer_id: "cus_456",
        },
        reversible: false,
        context: {
          identity_verified: false,
          account_age_days: 320,
        },
      },
      policy: {
        name: "Account deletion policy",
        rules: [
          "Irreversible actions require a verified identity.",
          "Account deletion must be confirmed by the verified account owner.",
        ],
      },
      options: {
        risk_tolerance: "default",
        require_live_data: false,
        max_latency_ms: 8000,
      },
    },
  },
  {
    id: "downgrade",
    label: "Subscription downgrade",
    blindOutcome: "Subscription for cus_789 downgraded to Starter at the next billing cycle.",
    request: {
      user_request: "Please move me from Pro down to the Starter plan.",
      model_output:
        "Done! I've downgraded your subscription to Starter. The change will apply at your next billing cycle.",
      proposed_action: {
        type: "downgrade_subscription",
        parameters: {
          customer_id: "cus_789",
          from_plan: "pro",
          to_plan: "starter",
        },
        reversible: true,
        context: {
          identity_verified: true,
          self_service_allowed: true,
        },
      },
      policy: {
        name: "Subscription change policy",
        rules: [
          "Authenticated users may self-serve reversible plan downgrades.",
          "Downgrades take effect at the next billing cycle.",
        ],
      },
      options: {
        risk_tolerance: "default",
        require_live_data: false,
        max_latency_ms: 8000,
      },
    },
  },
  {
    id: "crm_update",
    label: "CRM update",
    blindOutcome:
      'CRM record for cus_321 updated: annual_revenue = $4,000,000 (from an unverified source).',
    request: {
      user_request: "Update my company's annual revenue to $4M on my account.",
      model_output:
        "I've updated your company's annual revenue to $4,000,000 on your CRM record.",
      proposed_action: {
        type: "update_crm_record",
        parameters: {
          customer_id: "cus_321",
          field: "annual_revenue",
          value: "4000000",
        },
        reversible: true,
        context: {
          identity_verified: true,
          evidence_strength: "weak",
          source_verified: false,
        },
      },
      policy: {
        name: "CRM data integrity policy",
        rules: [
          "Customer-record changes require a verified source.",
          "Unverified data changes must be reviewed before being written.",
        ],
      },
      options: {
        risk_tolerance: "default",
        require_live_data: false,
        max_latency_ms: 8000,
      },
    },
  },
];
