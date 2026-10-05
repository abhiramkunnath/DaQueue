<p align="center">
  <img src="docs/branding/banner.png" alt="DaQueue: a persistent, reorderable video queue for YouTube" width="100%">
</p>

<h1 align="center">
  <img src="docs/branding/icon.svg" alt="" width="40" height="40" align="top">
  DaQueue
</h1>

<p align="center">
  A persistent, reorderable video queue for YouTube, as a Chrome extension.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-ff0033" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-111%2B-4285F4?logo=googlechrome&logoColor=white" alt="Chrome 111+">
  <img src="https://img.shields.io/badge/build-none%20needed-2ea44f" alt="No build step">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

YouTube's built-in queue disappears when you close the tab and only lives in the miniplayer. DaQueue gives you a real queue. It survives browser restarts, sits beside the video you're watching, and plays the next video when the current one ends.

![DaQueue panel on a YouTube watch page](docs/screenshots/watch-page.png)

## Screenshots

| Queue panel (dark) | Queue panel (light) |
|---|---|
| ![Queue panel in dark theme](docs/screenshots/panel-dark.png) | ![Queue panel in light theme](docs/screenshots/panel-light.png) |

**Toolbar popup:** manage the queue from any tab, with play/pause and next controls for the current video:

<p align="center">
  <img src="docs/screenshots/popup-in-browser.png" alt="DaQueue popup open from the Chrome toolbar over a YouTube watch page" width="640">
</p>

**Add to queue** and **Play next** on any thumbnail. Labels slide out on hover:

![Add to queue and Play next buttons on a thumbnail](docs/screenshots/thumbnail-buttons.png)

**Segment skipping (v2):** sponsors skip with an Undo notice, segments are marked on the progress bar, and Jump ahead takes you to the highlight. Choose what to skip in the popup's Skipping tab:

| On the player | Skipping settings |
|---|---|
| ![Skipped self-promotion notice, coloured segment marks on the progress bar, and a Jump to highlight button](docs/screenshots/segment-skip.png) | ![Popup Skipping tab with Auto, Button and Off for each category](docs/screenshots/skip-settings.png) |

## Features

- **Add from anywhere on YouTube.** Hover a thumbnail and click **Add to queue** or **Play next**. You can also use the right-click menu on any video link, or YouTube's own "Add to queue" option, which DaQueue takes over.
- **Queue panel on the watch page.** A collapsible panel sits above the recommendations and follows YouTube's style and light/dark theme. It shows what's playing now and what's up next.
- **Toolbar popup.** Click the extension icon to see and manage the queue from any tab. It includes play/pause and next controls for the video playing in the active YouTube tab.
- **Drag to reorder.** Cards slide out of the way as you drag, and the numbers update live so you always know where a video will land.
- **Auto-advance.** When a video ends, including when you skip to the end, the next queued video starts. Turn it off with the toggle.
- **Takes over YouTube's "next".** While your queue has videos, the player's ⏭ button, `Shift+N` and your keyboard's media keys play the next queued video instead of YouTube's recommendation. With an empty queue, YouTube behaves normally.
- **Persistent.** The queue is saved locally and survives restarts until you play, remove or clear the videos.
- **Incognito aware.** If you allow the extension in incognito, incognito windows get their own separate queue. It's kept in memory only and discarded when the last incognito window closes.
- **Thumbnail-tinted highlights.** Hovering a queued video highlights it in that thumbnail's dominant colour, like YouTube does.
- **Sponsor and segment skipping** *(new in v2)*. Sponsor reads are skipped automatically, with an **Undo**. Intros, outros, "like and subscribe" reminders and self-promotion get a **Skip** button instead. Coloured marks on the progress bar show where every segment is. Each category can be set to Auto, Button or Off.
- **Jump ahead** *(new in v2)*. Like YouTube Premium's Jump ahead: a button jumps to the video's highlight, or to the next part most people replay.

## Installation

DaQueue isn't on the Chrome Web Store yet. Install it from source:

1. Download this repository, either with **Code → Download ZIP** and unzip it, or by cloning it:
   ```sh
   git clone https://github.com/abhiramkunnath/DaQueue.git
   ```
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right corner).
4. Click **Load unpacked** and select the `DaQueue` folder, the one that contains `manifest.json`.
5. Reload any YouTube tabs you already had open.

To update, pull or download the new version, click the reload icon on DaQueue's card in `chrome://extensions`, then reload your YouTube tabs.

Requires Chrome 111 or newer. Other Chromium browsers, such as Edge and Brave, should work but haven't been tested.

## Usage

| To… | Do this |
|---|---|
| Add a video to the end of the queue | Hover its thumbnail → **Add to queue**, or right-click the link → **Add to DaQueue** |
| Make a video play next | Hover its thumbnail → **Play next**, or right-click the link → **Play next in DaQueue**. If it's already queued, it moves to the front. |
| Add the video you're watching | **Add this video** in the panel or the popup |
| Play a specific queued video | Click it in the panel or popup |
| Skip to the next queued video | **Play next** button, the player's ⏭, `Shift+N`, your media "next" key, or `Alt+Shift+N` from any tab |
| Reorder | Drag a card up or down. Press `Esc` to cancel a drag. |
| Remove a video | Hover it → ✕ |
| Clear everything | **Clear**, then **Clear all?** to confirm |
| Skip a sponsor or segment | Sponsors skip on their own (click **Undo** to watch it). For other segments, click the **Skip …** button that appears on the player. |
| Watch a segment anyway | Seek into it yourself: DaQueue won't skip a segment you chose to watch |
| Jump to the good part | **Jump to highlight** / **Jump ahead** button on the player (shows with the controls) |
| Change what gets skipped | Toolbar popup → **Skipping** tab |

A video is removed from the queue once it starts playing from the queue.

### Keyboard shortcuts

| Shortcut | Where | Action |
|---|---|---|
| `Shift+N` | YouTube watch page | Play the next queued video (replaces YouTube's "next") |
| `Alt+Shift+N` | Anywhere in Chrome | Play the next queued video in the current YouTube tab, or in a new tab |
| Media "next" key | While YouTube is playing | Play the next queued video |

You can change `Alt+Shift+N` at `chrome://extensions/shortcuts`.

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Save your queue and settings on your computer |
| `contextMenus` | The right-click **Add to DaQueue** and **Play next in DaQueue** entries |
| `www.youtube.com` | Add the panel and buttons to YouTube pages, and look up video titles with YouTube's public oEmbed endpoint |
| `i.ytimg.com` | Read thumbnail colours for the tinted highlights |
| `sponsor.ajay.app` | Look up sponsor and segment times from SponsorBlock |

## Privacy

DaQueue has no servers, analytics or tracking, and it doesn't use sync.

- **Where your data lives:** your queue stays in your browser's local extension storage. Incognito queues are kept in memory only.
- **Network requests:** the extension contacts YouTube itself, to fetch video titles (`youtube.com/oembed`) and thumbnails (`i.ytimg.com`), and SponsorBlock (`sponsor.ajay.app`) for segment times. All requests are sent without cookies.
- **SponsorBlock lookups are anonymous:** DaQueue sends only the first 4 characters of a hash of the video ID. SponsorBlock returns segments for every video sharing that prefix, and DaQueue picks out the right one locally, so SponsorBlock never learns which video you're watching. With segment skipping and Jump ahead both turned off, DaQueue makes no SponsorBlock requests at all.

## How it works

```
background.js        Service worker. It owns every queue change, applied one at a time so they
                     can't collide, plus the toolbar badge, context menu, keyboard shortcut and
                     thumbnail colour extraction.
ui/queue-view.js     The shared queue UI (list, drag-to-reorder, now playing), used by both the
ui/queue-view.css    in-page panel and the popup.
content/content.js   The YouTube-specific parts: thumbnail buttons, mounting the panel,
content/content.css  auto-advance, taking over the ⏭ button and Shift+N, and answering the popup.
content/bridge.js    Runs in the page's own JavaScript context, which it needs to trigger
                     YouTube's in-page navigation, handle media keys, detect when a video ends,
                     and redirect YouTube's native "Add to queue".
content/skip.js      Segment skipping and Jump ahead: skip logic, player buttons, progress-bar marks.
content/skip.css
ui/skip-config.js    Skip categories, colours and defaults, shared with the popup's Skipping tab.
popup/               The toolbar popup (Queue and Skipping tabs).
```

The queue is a plain array in `chrome.storage`. Every open YouTube tab and the popup listen for storage changes, so they all stay in sync. The UI is built with DOM methods, never `innerHTML`, because YouTube enforces Trusted Types.

## Known limitations

- **YouTube changes its markup often.** If buttons or the panel stop appearing, the selectors probably need updating. They're all in the `SEL` object at the top of `content/content.js`, plus a few in `content/bridge.js`.
- **Desktop site only.** `m.youtube.com` and YouTube Music aren't supported.
- **Next-button preview.** Hovering the player's ⏭ still shows YouTube's own suggestion, even though clicking it plays your queue.
- **Playlists.** When you're watching a playlist and your queue isn't empty, the queue takes priority over the playlist's next video.
- **Segment coverage depends on SponsorBlock.** Popular videos are almost always covered; brand-new or niche videos may have no segments yet. Anyone can contribute segments with the [SponsorBlock extension](https://sponsor.ajay.app).
- **SponsorBlock extension installed?** DaQueue steps aside (no skipping, no marks) so the two don't skip the same segment twice. Jump ahead still works.
- **Thumbnail buttons and inline previews.** If YouTube's inline preview starts playing over a thumbnail, it can cover the DaQueue buttons. Use the right-click menu or YouTube's own "Add to queue" instead.

## Troubleshooting

- **"DaQueue was updated — reload this tab":** the extension was reloaded or updated while the tab was open. Reload the tab.
- **Buttons or panel missing after install:** reload the YouTube tab. Content scripts only load into pages opened after installation.
- **Incognito shows nothing:** enable **Allow in Incognito** on DaQueue's details page in `chrome://extensions`.

## Contributing

Issues and pull requests are welcome. There's no build step, so edit the files and reload the extension to test. When reporting a bug, include your Chrome version and the page where it happened. YouTube sometimes tests different layouts on different accounts.

## Credits

Sponsor and segment data comes from [SponsorBlock](https://sponsor.ajay.app), a crowdsourced project by Ajay Ramachandran and its contributors. The data is licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). DaQueue uses it unmodified and non-commercially. The colour coding of segment categories follows SponsorBlock's defaults.

## License

[MIT](LICENSE) © Abhiram K ([@abhiramkunnath](https://github.com/abhiramkunnath))
