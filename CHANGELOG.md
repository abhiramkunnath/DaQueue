# Changelog

## 2.0.0

### Added
- **Sponsor and segment skipping** using [SponsorBlock](https://sponsor.ajay.app) data.
  - Sponsor reads auto-skip by default, with an Undo notice on the player.
  - Self-promotion, interaction reminders, intros, outros and previews show a **Skip** button.
  - Filler and non-music sections are off by default.
  - Each category can be set to Auto, Button or Off in the new **Skipping** tab of the popup.
  - Coloured segment marks on the progress bar.
  - Seeking into a segment yourself means it won't be skipped.
  - Segments recorded against a different version of a video (duration mismatch over 3s) are ignored.
  - Skipping is disabled automatically when the SponsorBlock extension is installed.
- **Jump ahead**: a player button that jumps to the SponsorBlock highlight, or to the next "most replayed" peak from YouTube's heatmap.
- Popup now has **Queue** and **Skipping** tabs.

### Privacy
- SponsorBlock lookups send only a 4-character hash prefix of the video ID, never the ID itself.

### Changed
- Skips seek through YouTube's own player API rather than the `<video>` element, which avoids playback stalls.

## 1.0.0

Initial release: persistent, reorderable YouTube queue with an in-page panel, toolbar popup, drag-to-reorder, auto-advance, and takeover of YouTube's Next button, `Shift+N`, media keys and native "Add to queue".
