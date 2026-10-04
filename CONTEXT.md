# Keeply — terminology

- **Appliance** — a household item owned by a home. v0.1: dishwashers only.
- **Task** — a maintenance task Keeply proposes for a dishwasher: name, instructions, interval, evidence level and source (title, link, page, quote). Never rewritten; the owner accepts or rejects it.
- **Evidence level** — 1 *Manufacturer verified* (quoted from the manufacturer's own document, with a link), 2 *Similar-model inference*, 3 *General guidance*. Inferred and general guidance must never look verified.
- **Approval** — the explicit user action, once every task is accepted or rejected, that writes the accepted tasks to Google Calendar as recurring events from a start date. Nothing is written before it. After it the owner manages the events in their calendar.
- **Magic moment** — photo to approved calendar plan in about one minute.
- **AI provider** — where AI usage comes from: *ChatGPT-authorized* (the owner's ChatGPT plan, if OpenAI permits), *BYO API key* (self-hosted server config), *Keeply-hosted* (app-funded), or *Manual* (no AI). Separate from the Keeply account: being signed in grants no AI usage.
