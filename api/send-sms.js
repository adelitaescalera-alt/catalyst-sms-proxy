const twilio = require('twilio');
export default function(req, res) {
  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  client.messages.create({
    body: req.body.message,
    from: process.env.TWILIO_FROM,
    to: req.body.to
  }).then(() => res.json({ ok: true }));
} up
