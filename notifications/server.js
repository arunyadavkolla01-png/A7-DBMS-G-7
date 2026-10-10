import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
const mongo = new MongoClient(process.env.MONGO_URL);
let col;

async function bootstrap() {
  await mongo.connect();
  col = mongo.db(process.env.MONGO_DB).collection("notifications");
  await col.createIndex({ user_id: 1, created_at: -1 });
  console.log("[mongo] notifications ready");
}

function authRequired(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing token" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "invalid token" }); }
}

async function storeNotification({ user_id, event_type, title, body, meta }) {
  if (!col || !user_id) return;
  await col.insertOne({ user_id, event_type, title, body, meta: meta || {}, read: false, created_at: new Date() });
}

function renderNotification(env) {
  const p = env.payload || {};
  switch (env.event_type) {
    case "user.registered":
      return { user_id: p.user_id, event_type: "welcome", title: "Welcome to TripWise",
        body: `Hi ${p.name || "traveler"}, your account is ready.`, meta: {} };
    case "booking.created":
      return { user_id: p.user_id, event_type: "booking",
        title: `Booking received — ${p.booking_ref || ""}`,
        body: `${p.origin || ""} -> ${p.destination || ""} · ₹${Number(p.price||0).toLocaleString("en-IN")}.`,
        meta: { booking_id: p.booking_id, booking_ref: p.booking_ref } };
    case "booking.plan.attached":
      return { user_id: p.user_id, event_type: "booking", title: "Activities added",
        body: `${p.items} place(s) added. Extra: ₹${Number(p.add_on||0).toLocaleString("en-IN")}.`,
        meta: { booking_id: p.booking_id } };
    case "payment.successful":
      return { user_id: p.user_id, event_type: "status",
        title: `Payment received — ${p.booking_ref || ""}`,
        body: `₹${Number(p.amount||0).toLocaleString("en-IN")} received. Booking confirmed.`,
        meta: { booking_id: p.booking_id, status: "confirmed" } };
    case "booking.status.changed": {
      const s = p.new_status || "updated";
      let title = `Booking ${s} — ${p.booking_ref || ""}`;
      let body = `Booking ${p.booking_ref || ""} status is now ${s}.`;
      if (s === "confirmed") body = "Your booking is confirmed. Have a great trip!";
      if (s === "cancelled") body = `Booking ${p.booking_ref || ""} was cancelled.`;
      return { user_id: p.user_id || null, event_type: "status", title, body,
        meta: { booking_id: p.booking_id, booking_ref: p.booking_ref, status: s } };
    }
    default:
      return { user_id: p.user_id || null, event_type: env.event_type,
        title: env.event_type, body: JSON.stringify(p).slice(0, 200), meta: {} };
  }
}

app.post("/notify", async (req, res) => {
  const env = req.body;
  const n = renderNotification(env);
  await storeNotification(n);
  res.json({ ok: true });
});

app.get("/notifications", authRequired, async (req, res) => {
  const list = await col.find({ user_id: req.user.sub }).sort({ created_at: -1 }).limit(50).toArray();
  res.json(list);
});

app.patch("/notifications/:id/read", authRequired, async (req, res) => {
  await col.updateOne({ _id: new ObjectId(req.params.id), user_id: req.user.sub }, { $set: { read: true } });
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ service: "notifications", status: "ok", port: PORT }));

async function startKafkaConsumer() {
  const { Kafka } = await import("kafkajs");
  const kafka = new Kafka({ clientId: "tripwise-notifications", brokers: [process.env.KAFKA_BROKER] });
  const consumer = kafka.consumer({ groupId: "tripwise-notif-group" });
  await consumer.connect();
  await consumer.subscribe({ topic: process.env.KAFKA_TOPIC, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const env = JSON.parse(message.value.toString());
        const n = renderNotification(env);
        await storeNotification(n);
        console.log("[kafka]", env.event_type, "→", n.user_id);
      } catch (e) { console.error("[kafka]", e.message); }
    },
  });
  console.log("[kafka] consumer started");
}

bootstrap().then(() => {
  if (process.env.KAFKA_ENABLED === "true") {
    startKafkaConsumer().catch(e => console.warn("[kafka]", e.message));
  }
  app.listen(PORT, () => console.log(`notifications on :${PORT}`));
}).catch(e => { console.error(e); process.exit(1); });