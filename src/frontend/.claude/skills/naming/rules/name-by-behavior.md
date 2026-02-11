# Name by Behavior

Names of functions, classes, and components should describe **what they do**, not how they happen to be used.

## Rule

When naming a component, function, or class, ask: "What does this thing DO?" not "Where/how is this thing USED?"

## Examples

### Components

| Bad (usage context) | Good (behavior) | Why |
|---------------------|-----------------|-----|
| `GalleryVideoPlayer` | `MediaPlayer` | Plays media - doesn't matter where |
| `HomePageHero` | `HeroSection` | It's a hero section - could be used anywhere |
| `SidebarNavigation` | `NavigationMenu` | It's a nav menu - sidebar is layout context |
| `MobileHeader` | `CompactHeader` | Describes the header style, not device |

### Hooks

| Bad (usage context) | Good (behavior) | Why |
|---------------------|-----------------|-----|
| `useGalleryState` | `usePlaybackState` | Manages playback state |
| `useEditorKeyboard` | `useKeyboardShortcuts` | Handles keyboard shortcuts |

### Functions

| Bad (usage context) | Good (behavior) | Why |
|---------------------|-----------------|-----|
| `handleGalleryClick` | `handleVideoSelect` | Selects a video |
| `formatForExport` | `formatTimestamp` | Formats a timestamp |

## Benefits

1. **Reusability**: `MediaPlayer` can be used in Gallery, modals, embeds - anywhere
2. **Self-documenting**: Name tells you what to expect
3. **Stable**: Usage context changes; behavior rarely does
4. **Composable**: Behavior-named components compose better

## Anti-patterns

- Naming by screen: `AnnotateControls` → `PlaybackControls`
- Naming by position: `TopNavBar` → `NavigationBar`
- Naming by device: `MobileDrawer` → `SlideOutDrawer`
- Naming by route: `SettingsPageForm` → `SettingsForm`
