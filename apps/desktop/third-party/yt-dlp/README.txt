yt-dlp
https://github.com/yt-dlp/yt-dlp

Scia ships yt-dlp's own build for this system, unchanged, as a separate program it runs to read
the page of a video (docs/adr/0009-the-video-of-a-page.md in Scia's repository). The version and
the checksum of each build are fixed in apps/desktop/scripts/fetch-tools.ts.

yt-dlp's code is released under the Unlicense. Its builds bundle Python and other libraries, and
the yt-dlp project distributes them under the GNU General Public License, version 3 or later,
whose text is in COPYING.txt beside this file. The source of every version is published with its
release; this one's: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26
