# Mission brief (verbatim from the commissioning request)

Competitive Architecture and Live Demo Design Tournament.

Goal: the most technically impressive, visually compelling, and credible **five-minute live
demonstration of a real, deployed web application running on AWS**. The audience is exceptionally
technical engineers, architects and engineering leaders who understand distributed systems,
databases, concurrency, infrastructure, security and modern architecture. They will not be impressed
by superficial complexity, mock functionality, generic dashboards, or disconnected CRUD screens.

The application must also run locally in containers, using **the same application artifacts** as the
AWS deployment. The local deployment must not be a diminished simulation of production. External
cloud integrations sit behind explicit interfaces; where local substitutes are necessary they keep
externally observable behaviour identical and the infrastructure differences are documented. No live
third-party services, paid APIs or unpredictable external dependencies in the core demo.

## Mandatory application characteristics

- A polished, professional web interface.
- A rich, interconnected feature set.
- A genuine backend with persistent storage.
- Meaningful domain logic beyond CRUD.
- Multiple interacting users, roles, or sessions.
- Real-time or near-real-time state changes.
- Nontrivial workflows with observable state transitions.
- Meaningful security and authorization boundaries.
- At least one sophisticated technical capability that can be demonstrated live.
- A cohesive narrative that makes the entire demonstration understandable.
- Realistic, reproducible sample data.
- Automated end-to-end validation.

## Five-minute demonstration constraints

About 300 seconds, a choreographed sequence of operations. Each operation builds on the previous,
demonstrates meaningful system behaviour, reveals additional capabilities, produces an immediate
visible result, and needs minimal explanation. Favour actions that demonstrate several capabilities at
once (e.g. one action triggers authorization checks, a transactional state change, asynchronous
processing, a real-time update in another session and an observable audit event). Make the audience
*see* the system substantiate its claims. Compelling to a first-time viewer. The first 30 seconds
establish purpose and create interest; the final 30 seconds deliver the strongest moment. Avoid
lengthy setup, waiting, typing, navigating or explaining.

## Required competitor deliverables

A. Product concept — application, users, problems solved, why it suits this demo.
B. Capability inventory — every major feature, its technical significance, how it interacts with
   others; distinguish directly-demonstrated from supporting capabilities.
C. Five-minute live script — second-by-second timeline: presenter action, expected behaviour, visible
   result, capabilities demonstrated, duration, transition.
D. Technical architecture — components, persistence model, communication, security boundaries,
   consistency requirements, deployment topology; detailed enough for another engineer to implement.
E. AWS and local deployment — container-first, immutable images, reproducible configuration, all
   infrastructure and dependencies.
F. Technical credibility — the five strongest technical claims, each with an executable test or
   observable behaviour that proves it.
G. Failure analysis — implementation difficulties, demo failures, hidden complexity, features that
   look impressive but are technically shallow.
H. Feasibility — implementation complexity, critical dependencies, likely sources of schedule risk.
   Favour reuse and composability over unrelated functionality.

## Evaluation framework (0–10 per criterion)

| Criterion | Weight |
|---|---:|
| Demonstrable technical depth | 25% |
| Cohesion and feature composition | 20% |
| Visual and interactive impact | 15% |
| Credibility to expert engineers | 15% |
| Five-minute narrative quality | 10% |
| Implementation feasibility | 10% |
| Live-demo reliability | 5% |

Disqualify proposals that depend on fake functionality, unverifiable architectural claims, or
fundamentally incompatible local and cloud deployments. A sophisticated feature that cannot be
reliably demonstrated is penalised heavily.

## Demonstration reliability

One-command local startup; one-command demo-data reset; predictable initial conditions; automated
browser-based rehearsal; multiple simultaneous browser sessions; stable sample identities and
permissions; no reliance on random external events; clear health and readiness checks;
recoverability after interrupted demos; identical core behaviour local vs AWS. The app must work
outside the scripted demo — no hardcoded sequence that only appears to work.

## Implementation readiness

Dependency-aware plan: a minimum vertical slice proving the architecture, then successive capability
layers to the full demo, every layer runnable and testable. Avoid premature abstraction, speculative
infrastructure and unnecessary microservices. Prefer simple robust implementations that support
sophisticated observable behaviour.

## House rule for every document in this directory

No estimates of how long work will take — no hours, days, weeks, sprints, story points, t-shirt sizes
or "quick". Convey feasibility and scope by what a change touches (components, interfaces, number of
moving parts) and by dependency order. Measured or estimated *quantities* (latency, throughput, row
counts, memory) are fine when labelled.
