# HANDOFF.md --- Home Appliance PPM / Circular Economy App

## 1. Product concept

Build a mobile-first web app that gives ordinary consumers **planned
preventive maintenance (PPM) for household appliances**.

The core idea:

> Scan something you own. Identify it. Find trustworthy maintenance
> guidance. Let the owner approve the maintenance plan. Put only the
> approved tasks into their calendar.

The broader mission is **asset longevity and circular economy**: help
people maintain, repair, and keep products for longer rather than
prematurely replacing them.

Long-term product loop:

**SCAN → MAINTAIN → DIAGNOSE → REPAIR → TRANSFER → REUSE**

This is not intended to be just another home-management dashboard.

------------------------------------------------------------------------

## 2. v0.1 success criterion

The first prototype should prove one "magic moment":

> A user photographs their dishwasher and, in under approximately one
> minute, gets a trustworthy proposed maintenance plan,
> approves/customizes it, and adds the selected tasks to Google
> Calendar.

Start with **dishwashers only**.

Do not expand appliance categories until this flow is reliable.

------------------------------------------------------------------------

## 3. v0.1 user flow

1.  User opens the PWA on their phone.
2.  User chooses **Scan appliance**.
3.  User takes/uploads a photo, preferably including the appliance data
    plate/model information.
4.  AI attempts to extract:
    -   appliance category
    -   manufacturer
    -   model
    -   serial number, if visible
5.  User confirms/corrects identification.
6.  System searches for trustworthy manufacturer/model maintenance
    information.
7.  System generates a **proposed maintenance plan**.
8.  Every proposed task shows:
    -   task name
    -   recommended frequency
    -   short instructions
    -   evidence/confidence level
    -   source/provenance where available
9.  User chooses independently for every task:
    -   **Include**
    -   **Customize**
    -   **Skip**
10. User selects a start date/preferred timing where needed.
11. User presses **Approve maintenance plan**.
12. Only approved tasks are written to Google Calendar.
13. App stores the appliance, approved plan, original recommendation,
    and source.

Nothing should be added to a user's calendar before explicit approval.

------------------------------------------------------------------------

## 4. Evidence and trust model

This is a core product principle.

### Level 1 --- Manufacturer verified

The guidance comes from documentation for the exact identified model or
an authoritative manufacturer source.

Example:

> Manufacturer verified --- Bosch model XYZ. Clean filter monthly.
> Source: manufacturer manual, page X.

### Level 2 --- Similar-model inference

Exact model guidance could not be verified, but relevant guidance exists
for sufficiently similar appliances/models.

Example:

> Similar-model guidance --- We could not verify this recommendation for
> your exact model. Comparable Bosch dishwashers in this product family
> recommend monthly filter cleaning.

The UI must make clear that this is inferred.

### Level 3 --- General guidance

No reliable exact/similar-model recommendation was found, but a broadly
applicable maintenance practice can still be suggested.

Example:

> General guidance --- We could not identify model-specific guidance.
> General dishwasher maintenance commonly includes checking and cleaning
> the filter.

### Non-negotiable rule

**Never present inferred or general guidance as manufacturer-verified
guidance.**

Do not hide uncertainty behind generic "use at your own risk" language.

The system should communicate:

-   what it knows
-   what it does not know
-   why it is recommending something
-   where the information came from
-   how confident the system is

------------------------------------------------------------------------

## 5. Manufacturer recommendation vs user schedule

Store these separately.

Example:

-   Manufacturer recommendation: every 14 days
-   User-selected schedule: every 30 days

Never rewrite the manufacturer's recommendation to match the user's
preference.

This distinction is important for transparency and future
lifecycle/service history.

------------------------------------------------------------------------

## 6. Completion-based scheduling

Where appropriate, support maintenance intervals based on **actual
completion**, not only fixed calendar recurrence.

Example:

-   Task interval: every 30 days
-   Due: 1 June
-   User completes: 6 June
-   Next due: 6 July

This can be added after the basic Google Calendar integration if
necessary, but the data model should allow it from the beginning.

------------------------------------------------------------------------

## 7. Proposed technical stack

### Frontend

-   **Next.js**
-   **TypeScript**
-   Mobile-first responsive UI
-   **PWA** before native iOS/Android apps

### Hosting

-   **Vercel**

Start on the free tier.

### Database / backend services

-   **Supabase**
-   PostgreSQL
-   Authentication as required
-   Storage for appliance images/documents
-   Server-side/backend functions where appropriate

Start on the free tier.

### Source control

-   **GitHub**
-   Public/open-source repository when ready to publish

### AI

-   OpenAI models for:
    -   image/data-plate interpretation
    -   structured appliance identification
    -   extracting structured maintenance information from source
        material
    -   transforming evidence into proposed PPM tasks

Prefer structured outputs.

AI must not be treated as the authoritative source for maintenance
intervals.

### Calendar

Start with:

-   **Google Calendar**

Later consider:

-   Apple Calendar
-   Microsoft Outlook Calendar

For v0.1, Google Calendar is sufficient.

------------------------------------------------------------------------

## 8. AI access / cost strategy

Initial objective:

> **Recurring infrastructure commitment should be approximately €0/month
> while validating the idea, within provider free-tier limits.**

Do not subsidize unrestricted AI usage for beta users.

Potential access paths:

### ChatGPT users

Investigate/use **Sign in with ChatGPT** and eligible user-authorized
ChatGPT plan usage where available and approved for the application.

Do not assume this access is automatically available to every
application; implement according to current OpenAI requirements.

### Open-source / self-hosted users

Allow technically capable users to configure their own OpenAI API
credentials.

### Hosted users without eligible ChatGPT access

For the earliest beta:

-   allow manual appliance entry and non-AI functionality, or
-   defer hosted AI access until a sustainable paid/funded model exists.

Do **not** expose a "paste your API key" experience as the normal
consumer UX.

------------------------------------------------------------------------

## 9. Initial data model

Keep the schema simple.

### users

-   id
-   name
-   email
-   created_at

### homes

-   id
-   user_id
-   name
-   created_at

### appliances

-   id
-   home_id
-   category
-   manufacturer
-   model
-   serial_number
-   image_url
-   identification_confidence
-   created_at

### source_documents

-   id
-   appliance_id
-   source_type
-   title
-   url/reference
-   manufacturer
-   model_scope
-   retrieved_at

### maintenance_recommendations

Represents what the evidence/source says.

-   id
-   appliance_id
-   task_name
-   description
-   recommended_interval
-   evidence_level
-   source_document_id
-   source_location/page
-   confidence
-   created_at

### maintenance_tasks

Represents what the user actually approved.

-   id
-   appliance_id
-   recommendation_id
-   status
-   user_interval
-   start_date
-   scheduling_mode
-   calendar_event_id
-   created_at

Suggested status values:

-   proposed
-   approved
-   skipped
-   paused

Suggested scheduling modes:

-   fixed_calendar
-   completion_based

### maintenance_completions

-   id
-   maintenance_task_id
-   completed_at
-   notes
-   created_at

------------------------------------------------------------------------

## 10. Core UI screens for v0.1

Only build what is necessary.

### A. Home

-   My appliances
-   Scan appliance
-   Add manually

### B. Scan / Upload

-   Camera/photo input
-   Clear guidance to photograph appliance/model label

### C. Confirm identification

Example:

> Dishwasher\
> Bosch\
> SMS6ZCI49E\
> Is this correct?

Actions:

-   Confirm
-   Edit
-   Rescan

### D. Proposed maintenance plan

This is one of the most important screens.

For each task:

**Clean filter**\
Manufacturer recommendation: Monthly\
Evidence: **Manufacturer verified**\
Why? / View source

Actions:

-   Include
-   Customize
-   Skip

### E. Customize task

Allow user to change:

-   frequency
-   start date
-   preferred timing

Always continue displaying the original manufacturer recommendation
separately.

### F. Final approval

Summary of tasks that will be added.

Primary action:

**Approve maintenance plan**

Only after this action should calendar events be created.

### G. Appliance record

Show:

-   appliance identity
-   approved maintenance plan
-   upcoming tasks
-   completion history
-   source/manual information

------------------------------------------------------------------------

## 11. What NOT to build in v0.1

Do not build these yet:

-   native iOS app
-   native Android app
-   Stripe/payments
-   premium subscriptions
-   repair marketplace
-   spare-parts marketplace
-   retailer integrations
-   landlord/property portfolio product
-   carbon accounting engine
-   sophisticated repair-vs-replace engine
-   warranties/receipt management
-   dozens of appliance categories
-   social features
-   elaborate dashboards

First prove the scan → evidence → approval → calendar workflow.

------------------------------------------------------------------------

## 12. Product differentiation

Existing products already cover portions of:

-   appliance identification
-   manuals
-   home inventory
-   maintenance reminders
-   home-management tasks

Therefore, do **not** position the product simply as:

> "Take a picture and get appliance maintenance reminders."

The intended differentiation is:

### Asset longevity

The product exists to extend useful product life.

### Circular economy

Maintenance should ultimately connect to:

-   repair
-   reuse
-   transferable service history
-   avoided premature replacement

### Transparent AI

Every recommendation has provenance and confidence.

### User control

AI proposes. **The owner approves.**

### Calendar-first UX

Users should not need to constantly return to another dashboard just to
remember routine maintenance.

------------------------------------------------------------------------

## 13. Long-term opportunities --- not MVP scope

Potential future lifecycle:

### Diagnose

When an appliance develops a problem, use the known exact model, manual,
age, and maintenance history to assist diagnosis.

### Repair

Surface:

-   repair instructions
-   likely causes
-   appropriate parts
-   professional repair options

### Repair vs replace

Eventually support evidence-based lifecycle decisions using:

-   age
-   repair cost
-   replacement cost
-   expected remaining life
-   energy efficiency
-   embodied/environmental impact

### Digital service book

Create a transferable service history for the appliance.

When an appliance is sold or transferred, the next owner could receive:

-   model details
-   maintenance history
-   repairs
-   documentation
-   service record

### B2B2C

Potential partners:

-   appliance retailers
-   manufacturers
-   repair networks
-   warranty providers

Possible proposition:

> Scan to activate your appliance's digital service book.

### Property portfolios

Potential future professional product for landlords/property managers
with large domestic appliance inventories.

Keep this separate from the initial consumer MVP.

------------------------------------------------------------------------

## 14. Potential monetization model

Do not optimize monetization before proving usage.

Possible progression:

1.  Open-source core / self-hosted
2.  Free hosted consumer tier
3.  Consumer premium subscription
4.  Hosted AI allowance as part of premium
5.  Repair/service marketplace
6.  Retailer/manufacturer partnerships
7.  Portfolio/landlord offering

A possible future premium price hypothesis discussed was approximately
**€4.99/month or an annual equivalent**, but this is only a hypothesis
and should be validated.

------------------------------------------------------------------------

## 15. Validation target

Before adding major scope, get approximately **10 independent users** to
test the flow.

Early signal worth pursuing:

> Can we eventually get 100 people who are not involved in building the
> product to voluntarily register an appliance and keep at least one
> maintenance task active?

Measure:

-   scan started
-   appliance successfully identified
-   model confirmed
-   maintenance recommendations generated
-   recommendations approved/customized/skipped
-   calendar connected
-   calendar tasks created
-   maintenance task completed
-   user returns/adds another appliance

------------------------------------------------------------------------

## 16. Build order

### Phase 0 --- Foundation

-   [ ] Create GitHub repository
-   [ ] Create Next.js + TypeScript app
-   [ ] Configure PWA basics
-   [ ] Deploy to Vercel
-   [ ] Create Supabase project
-   [ ] Add environment-variable structure
-   [ ] Create initial database migrations/schema

### Phase 1 --- Manual workflow

Build the product logic without depending on AI.

-   [ ] Add appliance manually
-   [ ] Create proposed maintenance tasks manually
-   [ ] Build Include / Customize / Skip UI
-   [ ] Build final approval screen
-   [ ] Connect Google Calendar
-   [ ] Write approved tasks to calendar

### Phase 2 --- Appliance scanning

-   [ ] Camera/photo upload
-   [ ] Structured appliance extraction
-   [ ] Confirmation/correction screen
-   [ ] Store appliance identity

### Phase 3 --- Evidence retrieval

-   [ ] Find manufacturer/model documentation
-   [ ] Capture source provenance
-   [ ] Extract candidate maintenance requirements
-   [ ] Classify evidence level
-   [ ] Prevent unsupported claims from being labelled verified

### Phase 4 --- Full magic-minute workflow

-   [ ] Photo
-   [ ] Identification
-   [ ] Source retrieval
-   [ ] Proposed PPM
-   [ ] User approval/customization
-   [ ] Google Calendar creation
-   [ ] End-to-end test on real dishwasher

### Phase 5 --- Beta validation

-   [ ] Test across multiple dishwasher brands/models
-   [ ] Test failure states
-   [ ] Test missing exact manual
-   [ ] Test inferred guidance
-   [ ] Test general guidance
-   [ ] Test calendar permission denial
-   [ ] Recruit 5--10 external testers
-   [ ] Observe usage before adding features

------------------------------------------------------------------------

## 17. Development principles

1.  **Trust before cleverness.**
2.  **AI proposes; humans approve.**
3.  **Evidence and inference must never look identical.**
4.  **Do not add anything to a calendar without explicit approval.**
5.  **Store manufacturer guidance separately from user preferences.**
6.  **Design for completion-based scheduling even if implemented
    later.**
7.  **Keep infrastructure cost near zero during validation.**
8.  **Do not build features before the core workflow proves useful.**
9.  **Mobile-first.**
10. **Dishwashers first.**

------------------------------------------------------------------------

## 18. Immediate next task

Start implementation with **Phase 0 + Phase 1**.

The first development milestone should be:

> A deployed mobile-first PWA where a user can manually create a
> dishwasher, review three mock maintenance recommendations, choose
> Include / Customize / Skip, approve the plan, and add only the
> approved tasks to Google Calendar.

Do this **before** building appliance AI recognition.

This gives the project a complete product skeleton and validates the
approval/calendar UX independently of the harder AI and source-retrieval
problem.

------------------------------------------------------------------------

## 19. Working product statement

Current working proposition:

> **PPM for your home. Scan what you own, understand how to maintain it,
> and keep it working for longer.**

Alternative internal framing:

> **A digital service book for the things you own.**

Neither is a final brand/tagline.

------------------------------------------------------------------------

## 20. Open decisions

Do not block initial development on these:

-   product name
-   final branding
-   exact premium pricing
-   public/private repository timing
-   final ChatGPT authorization implementation
-   Apple Calendar support
-   Outlook support
-   repair marketplace model
-   B2B pricing
-   carbon-savings methodology

Resolve these after the v0.1 workflow exists.

------------------------------------------------------------------------

## 21. Context for the next coding agent/session

When continuing this project:

1.  Read this file first.
2.  Do not expand scope without a clear reason.
3.  Preserve the evidence hierarchy.
4.  Preserve explicit user approval before calendar writes.
5.  Optimize for the dishwasher magic-minute workflow.
6.  Prefer simple, maintainable implementation over premature
    architecture.
7.  Keep the prototype deployable on Vercel + Supabase free tiers.
8.  Treat manufacturer/source provenance as first-class data, not an
    afterthought.
