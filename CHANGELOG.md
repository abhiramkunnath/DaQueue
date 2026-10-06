# Changelog

## 2.0.1

### Fixed
- In fullscreen, the **Jump ahead** / **Skip** buttons overlapped YouTube's like, dislike, comment and share row. They (and the "Skipped" notice) now sit above YouTube's own bottom-corner overlays, whatever is showing.

### Changed
- Popup tabs restyled like YouTube's channel tabs: text tabs with an underline that slides to the selected one.
- Switching between **Queue** and **Skipping** slides and cross-fades, and the popup height animates smoothly between the two.
- The popup sizes to its content (compact when the queue is empty), up to 580px; past that only the queue list scrolls.
- No more width jitter when switching tabs: the scrollbar's space is always reserved.
- The Skipping tab is tighter and fits without scrolling; long descriptions are shortened, with the full text on hover.
- The popup reopens on the tab you used last.

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
