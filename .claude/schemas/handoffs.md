# Structured Handoff Schemas

Standardized formats for passing context between agents. Reduces information loss and ensures consistent communication.

---

## Code Expert → Architect

```yaml
handoff:
  task_id: T{id}
  task_title: "{title}"

  entry_points:
    - file: "src/frontend/src/modes/overlay/OverlayMode.jsx"
      line: 108
      description: "Detection layer icon - will become toggle"
      current_behavior: "Static icon, no interaction"

    - file: "src/frontend/src/modes/OverlayModeView.jsx"
      line: 169
      description: "Current toggle button location"
      current_behavior: "Separate button with Eye/EyeOff icons"

  data_flow:
    - trigger: "User clicks toggle"
      path:
        - "OverlayModeView.onTogglePlayerBoxes()"
        - "OverlayContainer.togglePlayerBoxes()"
        - "setState({ showPlayerBoxes: !prev })"
        - "PlayerDetectionOverlay renders/hides"

  similar_patterns:
    - file: "src/frontend/src/modes/framing/FramingMode.jsx"
      pattern: "Layer icon with click handler"
      relevance: "Same UI pattern, can follow"

    - file: "src/frontend/src/components/timeline/RegionLayer.jsx"
      pattern: "Toggle enabled/disabled with visual feedback"
      relevance: "Similar toggle + visual state"

  existing_state:
    - name: "showPlayerBoxes"
      location: "OverlayContainer"
      type: "boolean"
      note: "Already exists - reuse, don't duplicate"

  dependencies:
    - "lucide-react icons (Crosshair)"
    - "Tailwind CSS classes"

  risks:
    - "Breaking existing toggle functionality"
    - "Visual inconsistency with other layer icons"
```

---

## Architect → Tester (Phase 1)

```yaml
handoff:
  task_id: T{id}
  design_doc: "docs/plans/tasks/T{id}-design.md"

  acceptance_criteria:
    - id: AC1
      description: "Clicking layer icon toggles player boxes"
      testable: true
      test_type: "E2E"

    - id: AC2
      description: "Icon shows slash when OFF"
      testable: true
      test_type: "E2E + Visual"

    - id: AC3
      description: "Old toggle button removed"
      testable: true
      test_type: "E2E (element not found)"

  state_changes:
    - variable: "showPlayerBoxes"
      before: "Toggled by button"
      after: "Toggled by layer icon"
      test_impact: "Update selectors in existing tests"

  files_to_test:
    - file: "src/frontend/src/modes/overlay/OverlayMode.jsx"
      changes: "New click handler on icon"
      coverage_needed: "E2E interaction test"

    - file: "src/frontend/src/modes/OverlayModeView.jsx"
      changes: "Button removed"
      coverage_needed: "Verify button gone"

  existing_tests:
    - file: "src/frontend/tests/overlay.spec.js"
      status: "May need selector updates"

  suggested_tests:
    - name: "layer icon toggles player boxes"
      type: "E2E"
      file: "src/frontend/tests/overlay.spec.js"

    - name: "layer icon shows slash when OFF"
      type: "E2E"
      file: "src/frontend/tests/overlay.spec.js"
```

---

## Architect → Implementor

```yaml
handoff:
  task_id: T{id}
  design_doc: "docs/plans/tasks/T{id}-design.md"

  files_to_modify:
    - path: "src/frontend/src/modes/overlay/OverlayMode.jsx"
      action: "modify"
      changes:
        - location: "line 108-115 (Detection layer icon)"
          type: "add_handler"
          pseudo: |
            <div onClick={() => onTogglePlayerBoxes()}>
              <Crosshair className={showPlayerBoxes ? 'green' : 'gray'} />
              {!showPlayerBoxes && <SlashOverlay />}
            </div>

    - path: "src/frontend/src/modes/OverlayModeView.jsx"
      action: "modify"
      changes:
        - location: "line 169-185"
          type: "remove"
          pseudo: "Remove entire toggle button block"

        - location: "OverlayMode props"
          type: "add"
          pseudo: "Pass showPlayerBoxes and onTogglePlayerBoxes"

  props_to_add:
    - component: "OverlayMode"
      props:
        - name: "showPlayerBoxes"
          type: "boolean"
          source: "OverlayModeView props"
        - name: "onTogglePlayerBoxes"
          type: "() => void"
          source: "OverlayModeView props"

  state_management:
    approach: "reuse_existing"
    details: "Use existing showPlayerBoxes state from OverlayContainer"
    note: "Do NOT create new state"

  patterns_to_follow:
    - reference: "src/frontend/src/modes/framing/FramingMode.jsx:104"
      pattern: "Layer icon with click handler"
      apply_to: "Detection layer icon"

  visual_requirements:
    - condition: "showPlayerBoxes === true"
      appearance: "Green Crosshair icon"

    - condition: "showPlayerBoxes === false"
      appearance: "Gray Crosshair icon with red diagonal slash"
```

---

## Implementor → Reviewer

```yaml
handoff:
  task_id: T{id}
  design_doc: "docs/plans/tasks/T{id}-design.md"

  changes_made:
    - file: "src/frontend/src/modes/overlay/OverlayMode.jsx"
      summary: "Added click handler and visual state to layer icon"
      lines_changed: "108-127"
      commit: "abc123"

    - file: "src/frontend/src/modes/OverlayModeView.jsx"
      summary: "Removed toggle button, passed props to OverlayMode"
      lines_changed: "7, 167-185, 302-304"
      commit: "abc123"

  design_compliance:
    - design_item: "Add click handler to layer icon"
      status: "done"
      location: "OverlayMode.jsx:116"

    - design_item: "Add visual slash when OFF"
      status: "done"
      location: "OverlayMode.jsx:120-125"

    - design_item: "Remove old toggle button"
      status: "done"
      location: "OverlayModeView.jsx:167"

  deviations:
    - description: "None - implemented exactly as designed"
    # OR if there were deviations:
    # - description: "Used div instead of button for icon wrapper"
    #   reason: "Better semantics for non-form element"
    #   impact: "None - same functionality"

  state_changes:
    - "No new state added"
    - "Reused existing showPlayerBoxes as designed"

  ready_for_review: true
```

---

## Tester → Main AI (Test Results)

```yaml
handoff:
  task_id: T{id}
  phase: "post_implementation"  # or "pre_implementation"

  test_results:
    summary:
      total: 15
      passed: 14
      failed: 1
      skipped: 0

    by_type:
      unit:
        passed: 8
        failed: 0
      e2e:
        passed: 6
        failed: 1

    failures:
      - test: "layer icon shows slash when OFF"
        file: "src/frontend/tests/overlay.spec.js:45"
        error: "Element not found: [data-testid='slash-overlay']"
        expected: "Slash overlay visible when showPlayerBoxes=false"
        actual: "Element with testid not found"
        suggested_fix: "Add data-testid='slash-overlay' to the slash div"

  coverage_assessment:
    - criterion: "AC1 - Toggle works"
      covered: true
      test: "overlay.spec.js:30"

    - criterion: "AC2 - Slash when OFF"
      covered: false
      reason: "Test failing - needs fix"

    - criterion: "AC3 - Old button removed"
      covered: true
      test: "overlay.spec.js:55"

  action_required:
    - "Fix: Add data-testid to slash overlay element"
    - "Re-run tests after fix"
```

---

## Usage

Agents should include relevant handoff data when completing their stage:

```
## Handoff to [Next Agent]

{yaml block from appropriate schema}
```

This ensures:
1. No context lost between stages
2. Clear expectations for next agent
3. Traceable decisions through workflow
