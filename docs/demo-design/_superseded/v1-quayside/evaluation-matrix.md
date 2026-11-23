# Evaluation matrix

Scores are copied from the reviewers' structured returns (the same numbers appear in their review files under `reviews/`). Weighted score = Σ weight × criterion score, computed mechanically from those numbers. Weights: depth 25 %, cohesion 20 %, visual 15 %, credibility 15 %, narrative 10 %, feasibility 10 %, reliability 5 %.

The evidence behind every individual score is in the reviewer files, one justification line per criterion per proposal. This file aggregates; it does not re-argue.

## Round 1 (original proposals)

### Reviewer A — Principal Systems Engineer

| Proposal | Depth | Cohesion | Visual | Credibility | Narrative | Feasibility | Reliability | Weighted | Disqualified |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 01 Tallyhouse (Systems Complexity) | 9 | 9 | 6 | 6 | 7 | 5 | 5 | 7.30 | no |
| 02 Tideline Live (Visual Spectacle) | 8 | 8 | 9 | 5 | 8 | 5 | 5 | 7.25 | no |
| 03 Ledgerwell (Enterprise Platform) | 8 | 9 | 7 | 6 | 8 | 6 | 6 | 7.45 | no |
| 04 Quayside (Emergent Composition) | 8 | 8 | 7 | 5 | 8 | 6 | 5 | 7.05 | no |
| 05 Culvert (Operational Resilience) | 9 | 8 | 7 | 5 | 8 | 6 | 5 | 7.30 | no |
| 06 Sealroom (Unconventional Innovation) | 7 | 7 | 6 | 6 | 9 | 6 | 6 | 6.75 | no |

### Reviewer B — Skeptical Technical Audience

| Proposal | Depth | Cohesion | Visual | Credibility | Narrative | Feasibility | Reliability | Weighted | Disqualified |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 01 Tallyhouse (Systems Complexity) | 9 | 8 | 6 | 8 | 7 | 5 | 5 | 7.40 | no |
| 02 Tideline Live (Visual Spectacle) | 7 | 7 | 9 | 6 | 8 | 5 | 5 | 6.95 | no |
| 03 Ledgerwell (Enterprise Platform) | 7 | 8 | 5 | 7 | 7 | 5 | 5 | 6.60 | no |
| 04 Quayside (Emergent Composition) | 8 | 9 | 7 | 7 | 8 | 6 | 6 | 7.60 | no |
| 05 Culvert (Operational Resilience) | 8 | 7 | 6 | 6 | 7 | 5 | 5 | 6.65 | no |
| 06 Sealroom (Unconventional Innovation) | 6 | 7 | 6 | 6 | 8 | 7 | 6 | 6.50 | no |

### Reviewer C — Implementation and Reliability

| Proposal | Depth | Cohesion | Visual | Credibility | Narrative | Feasibility | Reliability | Weighted | Disqualified |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 01 Tallyhouse (Systems Complexity) | 8.5 | 8.5 | 6.5 | 7.5 | 6.5 | 3.5 | 4 | 7.12 | no |
| 02 Tideline Live (Visual Spectacle) | 7.5 | 8 | 9 | 5.5 | 8 | 3 | 3.5 | 6.92 | **yes** — The headline finale (steps 256-300 s and claim 5) depends on an S3 Object Lock anchor that the proposal itself says the primary local run cannot faithfully reproduce: E.2 states MinIO's root can bypass retention and that the local verifier cannot prove the trust argument, while G.2 makes the local Compose run the primary run. The central security property of the stage demonstration therefore differs between the primary local deployment and the AWS deployment, which is a fundamental local/cloud incompatibility for a headline claim. Eligible again if the finale is AWS-only and labelled as such. |
| 03 Ledgerwell (Enterprise Platform) | 8 | 9 | 7 | 6.5 | 8 | 4.5 | 5 | 7.32 | no |
| 04 Quayside (Emergent Composition) | 8 | 8.5 | 7 | 6.5 | 7 | 5.5 | 5.5 | 7.25 | no |
| 05 Culvert (Operational Resilience) | 8.5 | 8 | 6.5 | 7.5 | 7.5 | 4.5 | 4.5 | 7.25 | no |
| 06 Sealroom (Unconventional Innovation) | 8 | 8.5 | 7 | 6.5 | 8.5 | 6 | 6.5 | 7.50 | no |

## Round 2 (revised proposals)

### Reviewer A — Principal Systems Engineer

| Proposal | Depth | Cohesion | Visual | Credibility | Narrative | Feasibility | Reliability | Weighted | Disqualified |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 01 Tallyhouse (Systems Complexity) | 8 | 8 | 6 | 5 | 7 | 5 | 4 | 6.65 | no |
| 02 Tideline Live (Visual Spectacle) | 8 | 8 | 9 | 5 | 8 | 5 | 5 | 7.25 | no |
| 03 Ledgerwell (Enterprise Platform) | 7 | 9 | 7 | 5 | 8 | 6 | 4 | 6.95 | no |
| 04 Quayside (Emergent Composition) | 8 | 8 | 7 | 5 | 8 | 6 | 5 | 7.05 | no |
| 05 Culvert (Operational Resilience) | 9 | 8 | 7 | 7 | 8 | 6 | 6 | 7.65 | no |
| 06 Sealroom (Unconventional Innovation) | 7 | 7 | 6 | 5 | 9 | 6 | 6 | 6.60 | no |

### Reviewer B — Skeptical Technical Audience

| Proposal | Depth | Cohesion | Visual | Credibility | Narrative | Feasibility | Reliability | Weighted | Disqualified |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 01 Tallyhouse (Systems Complexity) | 9 | 8 | 6 | 7 | 7 | 4 | 4 | 7.10 | no |
| 02 Tideline Live (Visual Spectacle) | 8 | 7 | 9 | 6 | 8 | 4 | 4 | 7.05 | no |
| 03 Ledgerwell (Enterprise Platform) | 7 | 8 | 5 | 6 | 7 | 5 | 5 | 6.45 | no |
| 04 Quayside (Emergent Composition) | 8 | 9 | 7 | 6 | 8 | 6 | 5 | 7.40 | no |
| 05 Culvert (Operational Resilience) | 8 | 7 | 6 | 6 | 7 | 4 | 4 | 6.50 | no |
| 06 Sealroom (Unconventional Innovation) | 7 | 7 | 5 | 5 | 8 | 5 | 4 | 6.15 | **yes** — The AWS run depends on BYPASSRLS roles that the proposal marks untested and cannot build as written on RDS. The score view owner sealroom_views and the operator role must be BYPASSRLS (D.2, D.5 item 3, E). PostgreSQL allows only a superuser to set BYPASSRLS and RDS does not give the master user superuser, so the stated fallback (migration creates sealroom_operator with the same grants) cannot be created. The AWS confidentiality mechanism and the rewrite climax therefore rest on an unverifiable architectural claim with no buildable fallback. Reinstatement needs a score view and operator role that do not depend on BYPASSRLS, proven on RDS. |

### Reviewer C — Implementation and Reliability

| Proposal | Depth | Cohesion | Visual | Credibility | Narrative | Feasibility | Reliability | Weighted | Disqualified |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 01 Tallyhouse (Systems Complexity) | 8.5 | 8.5 | 6.5 | 7.5 | 6.5 | 3.5 | 4.5 | 7.15 | no |
| 02 Tideline Live (Visual Spectacle) | 7.5 | 8 | 8.5 | 6.5 | 7.5 | 3 | 3 | 6.92 | no |
| 03 Ledgerwell (Enterprise Platform) | 8 | 8.5 | 7 | 6.5 | 8 | 5 | 4.5 | 7.25 | no |
| 04 Quayside (Emergent Composition) | 8 | 8.5 | 7 | 6 | 7.5 | 5.5 | 5.5 | 7.23 | no |
| 05 Culvert (Operational Resilience) | 8.5 | 8 | 6.5 | 7 | 7 | 4.5 | 4.5 | 7.12 | no |
| 06 Sealroom (Unconventional Innovation) | 7.5 | 8 | 7 | 6 | 8 | 5.5 | 5.5 | 7.05 | no |

## Summary

| Proposal | R1 A | R1 B | R1 C | R1 mean | R2 A | R2 B | R2 C | R2 mean | R2 rank by mean | Disqualifications |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 01 Tallyhouse (Systems Complexity) | 7.30 | 7.40 | 7.12 | 7.27 | 6.65 | 7.10 | 7.15 | **6.97** | 4 | none |
| 02 Tideline Live (Visual Spectacle) | 7.25 | 6.95 | 6.92 | 7.04 | 7.25 | 7.05 | 6.92 | **7.08** | 3 | R1 reviewer C |
| 03 Ledgerwell (Enterprise Platform) | 7.45 | 6.60 | 7.32 | 7.12 | 6.95 | 6.45 | 7.25 | **6.88** | 5 | none |
| 04 Quayside (Emergent Composition) | 7.05 | 7.60 | 7.25 | 7.30 | 7.05 | 7.40 | 7.23 | **7.23** | 1 | none |
| 05 Culvert (Operational Resilience) | 7.30 | 6.65 | 7.25 | 7.07 | 7.65 | 6.50 | 7.12 | **7.09** | 2 | none |
| 06 Sealroom (Unconventional Innovation) | 6.75 | 6.50 | 7.50 | 6.92 | 6.60 | 6.15 | 7.05 | **6.60** | 6 | R2 reviewer B |

### Reading the numbers

- The spread is narrow: round-2 means run from 6.60 to 7.23. Every proposal scored 8–9 on depth and cohesion from at least one reviewer, and every proposal lost most of its points on credibility, feasibility and reliability. The numbers separate the field less than the reviewers' written findings do, so the selection (see `selection-rationale.md`) rests on those findings, with the numbers as a check.
- Quayside (04) has the highest mean in both rounds and is the only proposal ranked in the top two by two of the three reviewers in round 2 (B first, C second). Reviewer A ranked it third.
- Culvert (05) is Reviewer A's round-2 winner (7.65, the highest single score in the tournament) and Reviewer B's fourth. The disagreement is substantive: A rewards its replay and fencing mechanisms; B penalises a crowded stage, a live run that is local only, and demo images that differ from release images.
- Revision moved the field very little. Mean change per proposal from round 1 to round 2: 01 -0.31, 02 +0.03, 03 -0.24, 04 -0.07, 05 +0.03, 06 -0.32. Reviewers repeatedly recorded that revisions fixed the mechanisms they were asked about and introduced new, smaller defects (most often an RDS privilege assumption).
- Disqualifications: 02 was disqualified by Reviewer C in round 1 (headline finale not reproducible locally) and reinstated in round 2 after the finale was labelled AWS-only. 06 was disqualified by Reviewer B in round 2 (its AWS confidentiality mechanism needs `BYPASSRLS`, which an RDS master user cannot grant).
