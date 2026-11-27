# D{{n}}. {{title}}

- Status: planned
- Records: {{records}}
- CI: {{ci}}
- Branch: `{{branch}}`

{{goal}}

## Constraints

<!-- One bullet each, citing the record it comes from. -->

## Done when

<!-- The definition of done, which /slipway:ship runs on the lane's head. Each item, here and in a step's done-when, is one plain command (no pipe, &&, ;, redirect or substitution) or a test name; a negative check, such as "no file says X", becomes a test. -->

- [ ] `slipway run gate` is green.

## Steps

<!-- Each step is one commit that one builder holds whole and one reviewer reads as one diff. Every step builds; none is a close-out. -->

### 1. {{first step}}

- [ ] Built
- Done when: {{done when}}
- Records: {{step records}}
- Paths: {{paths}}

## Asked at scope

<!-- Each of the operator's decisions: the answer, and what was declined. -->
