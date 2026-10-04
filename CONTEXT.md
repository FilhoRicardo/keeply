# Keeply — terminology

- **Appliance** — a household item owned by a home. v0.1: dishwashers only.
- **Recommendation** — what a source says to do (task, interval, evidence level, source). Never edited by the user.
- **Task** — what the owner approved from a recommendation, with their own interval, start date and scheduling mode.
- **Evidence level** — 1 *Manufacturer verified* (exact model or authoritative source), 2 *Similar-model inference*, 3 *General guidance*. Inferred and general guidance must never look verified.
- **Scheduling mode** — `fixed_calendar` or `completion_based` (next due = completion date + interval).
- **Approval** — the explicit user action that allows calendar events to be created. Nothing is written before it.
- **Magic moment** — photo to approved calendar plan in about one minute.
- **AI provider** — where AI usage comes from: *ChatGPT-authorized* (the owner's ChatGPT plan, if OpenAI permits), *BYO API key* (self-hosted server config), *Keeply-hosted* (app-funded), or *Manual* (no AI). Separate from the Keeply account: being signed in grants no AI usage.
