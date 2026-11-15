[English](community.en.md) · [فارسی](community.md)

# Community: share analyses, comment, chat

Community is a small social network inside Chart Terminal. You share an analysis (text, symbol, timeframe, direction, and optionally a chart snapshot), like and comment on other people's posts, follow people, and talk in live chat rooms. It runs on the server, so everyone connected to the same server sees the same Community.

## What you need

Community needs a **public server with accounts** (`CT_MODE=public`). See [docker.en.md](docker.en.md) for setting up a public server and [oauth-setup.en.md](oauth-setup.en.md) for sign-in with Google or Apple.

- Private server (a single owner) and the standalone app: there are no accounts, so there is no Community. The Community entry is still shown, with a short note: "Community needs a public server with accounts". It is not an error.
- Public server: sign in and Community works. The server reports this through `features.social` in `/api/auth/status`.

## Where to find it

Open **Community** from the ☰ menu or from the side/toolbar button. It has four tabs: **Feed**, **Following**, **Chat**, **Me**. It works with mouse, keyboard and touch, and fits phone width.

## Feed and posting

1. In **Feed**, use the "Share analysis" box.
2. Write your text (1 to 5000 characters). A title is optional (up to 120 characters).
3. Pick the direction: **Long**, **Short** or **Neutral**.
4. The symbol and timeframe are prefilled from the active chart; change them if you want.
5. Tick **Attach chart snapshot** to capture the active chart and attach it to the post. Then post.

On each post you can click the symbol chip to open that symbol on your chart, like it, open the comment thread, or use the **⋯** menu (Report, Block, Delete). You can filter the feed by the current symbol. **Following** shows only posts from people you follow. More posts load as you scroll or with "Load more".

Text is always shown as plain text. Only `http` and `https` links become clickable (opened with `noopener noreferrer nofollow`); HTML is never interpreted.

## Chat rooms

In **Chat** you can switch between two kinds of rooms:

- **General**: one room for everyone on the server.
- **Per-symbol room** (`sym:<SYMBOL>`, for example the room of the symbol on your chart).

Messages arrive live over the app's WebSocket connection; if the connection drops, it reconnects and catches up. A message is 1 to 500 characters. Enter sends, Shift+Enter adds a new line. The list scrolls to the newest message unless you have scrolled up. You can be in at most 3 rooms at once. Each message has a **⋯** menu (Report, Block, Delete).

## Follow, block, report

- **Follow**: click a name to open the profile (posts, followers, following) and press Follow or Unfollow. You cannot follow yourself.
- **Block**: hides that person's posts and chat messages from you. Manage and undo blocks in **Me**. You cannot block yourself.
- **Report**: from the **⋯** menu of a post, comment or chat message, with a short reason (up to 300 characters). You can report a given item only once.
- **Delete**: you can delete your own posts, comments and messages. The author of a post can also delete comments on it.

## What admins can do

Users with the `admin` role get a **Reports** queue in **Me**. For each report they can:

- **Hide**: hides the reported post, comment or chat message from everyone (the row stays in the database and the report is marked resolved).
- **Dismiss**: closes the report and leaves the content visible.

Admins can also delete any post, comment or chat message.

## Privacy

- Posts, comments and chat messages are visible to **everyone with an account on that server**, under their account name.
- A chart snapshot reuses the app's share feature: it is **public by link**. Anyone who has the link can open the image, even without an account. Attach a snapshot only if you are fine with that.
- Nothing leaves the server: Community data is stored in the server's own database and is not sent to any third party.
- Deleting an account removes that user's posts, comments, likes, follows, blocks, reports and chat messages.

## Abuse limits

Per user. Going over a limit returns an error and you can try again later.

| Action | Limit |
|---|---|
| Posts | 10 per hour |
| Comments | 40 per hour |
| Chat messages | 20 per minute |
| Likes | 300 per hour |
| Reports | 5 per hour |
| Follows | 60 per hour |

Also: an identical consecutive text from the same user is rejected, and new accounts get no extra privileges. Control characters are stripped and long runs of blank lines are collapsed.

## How a server owner moderates

1. Create or keep an admin account (see [docker.en.md](docker.en.md); the admin is set with `CT_ADMIN`).
2. Check **Me → Reports** regularly. Use **Hide** for rule-breaking content and **Dismiss** for false reports.
3. For a single bad item you can also just **Delete** it.
4. For a repeat offender, disable or remove the account with the usual admin tools; removing a user also removes their Community content.
5. Remember that snapshot links are public: hiding a post does not by itself invalidate its snapshot link.
