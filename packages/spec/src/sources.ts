import type { SourceBody } from "./nodes";

/**
 * The `orders` Source (spec 02 section 3.6.1). Owned by the data plane; `plinth-gen` writes exactly these columns
 * (plus `workspace_id`, which the query compiler filters on) and the seed commits this body as the Source node.
 */
export const ORDERS_SOURCE_SLUG = "orders";

export const ORDERS_ENUMS = {
  region: ["NA", "EMEA", "APAC", "LATAM", "ANZ"],
  carrier: ["Crane", "Swift", "Harbor", "Polar", "Meridian"],
  order_status: ["placed", "picked", "packed", "in_transit", "delivered", "returned"],
} as const;

export const ordersSourceBody = (): SourceBody => ({
  apiVersion: "plinth/v1",
  kind: "Source",
  metadata: { slug: ORDERS_SOURCE_SLUG, title: "Orders" },
  spec: {
    kind: "landed",
    domain: "fulfilment",
    time_column: "placed_at",
    primary_key: ["order_id"],
    shards: 1,
    partition: { by: ["placed_at"], granularity: "hour" },
    enums: {
      region: [...ORDERS_ENUMS.region],
      carrier: [...ORDERS_ENUMS.carrier],
      order_status: [...ORDERS_ENUMS.order_status],
    },
    fields: [
      { name: "order_id", type: "string", nullable: false, description: "UUID text." },
      { name: "region", type: "enum(region)", nullable: false, description: "Fulfilment region." },
      {
        name: "carrier",
        type: "enum(carrier)",
        nullable: true,
        description: "Null until handed to the carrier.",
      },
      { name: "status", type: "enum(order_status)", nullable: false, description: "Order status." },
      { name: "placed_at", type: "timestamp", nullable: false, description: "Event time." },
      { name: "picked_at", type: "timestamp", nullable: true },
      { name: "packed_at", type: "timestamp", nullable: true },
      {
        name: "handed_to_carrier_at",
        type: "timestamp",
        nullable: true,
        description: "End of the handoff stage.",
      },
      {
        name: "fulfilled_at",
        type: "timestamp",
        nullable: true,
        description: "Delivery time; end of the fulfilment latency.",
      },
      { name: "returned_at", type: "timestamp", nullable: true },
      { name: "sku_count", type: "int", nullable: false },
      { name: "order_value_cents", type: "int", nullable: false },
      { name: "customer_ref", type: "string", nullable: false, masked: true },
      {
        name: "fault_profile",
        type: "string",
        nullable: true,
        description: "FaultProfile that shaped this order, or null.",
      },
    ],
  },
});
