# Keeply — terminology

- **Appliance** — a household item owned by a home (dishwasher, fridge, washing machine, oven, dryer, anything with a manual). v0.1: any household appliance. Dishwashers are the only appliance with a hand-curated general-guidance fallback; every other appliance needs a found manual or the plan is honestly empty.
- **Task** — a maintenance task Keeply proposes for an appliance: name, instructions, interval, evidence level and source (title, link, page, quote). Never rewritten; the owner accepts or rejects it.
- **Evidence level** — 1 *Manufacturer verified* (quoted from the manufacturer's own document, with a link), 2 *Similar-model inference*, 3 *General guidance*. Inferred and general guidance must never look verified.
- **Approval** — the explicit user action, once every task is accepted or rejected, that writes the accepted tasks to Google Calendar as recurring events from a start date. Nothing is written before it. After it the owner manages the events in their calendar.
- **Magic moment** — photo to approved calendar plan in about one minute.
- **AI provider** — where AI usage comes from: *OpenRouter* (server-side configuration, the current AI provider) or *Manual* (no AI). Encrypted personal MiniMax BYO keys are retired; *ChatGPT-authorized* access is proposed, not implemented. Separate from the Keeply account: being signed in grants no AI usage.
