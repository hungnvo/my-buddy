# my-buddy

A pixel-art buddy, Mochi, that lives above your Claude Code prompt and acts out what the session is doing. Next to it: your context use, your 5-hour and 7-day limits, and a prompt-cache countdown.

![my-buddy above the prompt: context, 5h and 7d meters on the left, the buddy with its state and cache countdown on the right](docs/demo.png)

## Install

```sh
claude plugin marketplace add hungnvo/my-buddy
claude plugin install my-buddy@my-buddy
```

Then run `/reload-plugins`. On the 5-minute prompt cache, add `--config cacheTtlMinutes=5` to the install.

## Commands

- `/buddy` opens the buddy pane.
- `/buddy-demo` plays every animation.

## What you see

**Mochi** shows what the main thread is doing, with a short note like `editing register.tsx`. Subagents get their own smaller buddies.

<table>
<tr>
<td align="center"><img src="docs/states/idle.svg" width="64" alt="idle"><br>idle</td>
<td align="center"><img src="docs/states/thinking.svg" width="64" alt="thinking"><br>thinking</td>
<td align="center"><img src="docs/states/reading.svg" width="64" alt="reading"><br>reading</td>
<td align="center"><img src="docs/states/searching.svg" width="64" alt="searching"><br>searching</td>
<td align="center"><img src="docs/states/editing.svg" width="64" alt="editing"><br>editing</td>
<td align="center"><img src="docs/states/running.svg" width="64" alt="running"><br>running</td>
<td align="center"><img src="docs/states/browsing.svg" width="64" alt="browsing"><br>browsing</td>
</tr>
<tr>
<td align="center"><img src="docs/states/spawning.svg" width="64" alt="spawning"><br>spawning</td>
<td align="center"><img src="docs/states/waiting.svg" width="64" alt="waiting"><br>waiting</td>
<td align="center"><img src="docs/states/working.svg" width="64" alt="working"><br>working</td>
<td align="center"><img src="docs/states/error.svg" width="64" alt="error"><br>error</td>
<td align="center"><img src="docs/states/done.svg" width="64" alt="done"><br>done</td>
<td align="center"><img src="docs/states/compacting.svg" width="64" alt="compacting"><br>compacting</td>
<td></td>
</tr>
</table>

**Meters** on the left, one row each when there's data:

| Row | Example | Color |
| --- | --- | --- |
| `ctx` | `42k · 21%` | green → yellow → red → magenta at 50k / 100k / 150k tokens |
| `5h` | `34% · resets 3:40 PM` | green → yellow → red at 70% / 90% |
| `7d` | `12% · resets Fri` | same as `5h` |

**Cache countdown** under the label, e.g. `cache 4:12`: how long until the prompt cache goes cold. It turns yellow under a minute and reads `cache cold` once expired.

## Leveling

Mochi earns XP from real work and levels up each calendar month. XP is shared across all your sessions and resets on the 1st.

| Level | XP | Mochi gets |
| --- | --- | --- |
| 1 | 0 | — |
| 2 | 200 | a red bow tie |
| 3 | 900 | this month's hat |
| 4 | 2,500 | a golden body and sparkles |

| You… | XP | Daily cap |
| --- | --- | --- |
| finish a turn that used a tool | +1 | 40 |
| finish your first such turn of the day | +10 | 1 |
| commit | +5 | 10 |
| make your first commit of the day | +10 | 1 |
| open a PR | +20 | — |
| get a failing test to pass | +3 | 3 |
| say thanks | +2 | 5 |
| come back while the cache is still warm | +2 | 5 |

Commits, PRs and fixed tests flash a green `+N` next to Mochi. `/buddy` shows your progress (`Lv 2 · 340 / 900 XP`) and every month you reached Lv 4.

Hats: 🎉 Jan party hat · 💗 Feb heart headband · 🍀 Mar clover · ☔ Apr rain hood · 🌸 May flower crown · 🕶️ Jun sunglasses · 🍓 Jul strawberry · 👒 Aug sun hat · 🎓 Sep graduation cap · 🎃 Oct pumpkin · 🧶 Nov knit beanie · ❄️ Dec snow cap

<details>
<summary>Details</summary>

**What triggers each state**

| State | When |
| --- | --- |
| thinking | you submit a prompt |
| reading | `Read`, `LSP`, `Skill`, or Bash like `cat`, `sed`, `jq`, `git diff` |
| searching | `Grep`, `Glob`, `ToolSearch`, or Bash like `grep`, `rg`, `find`, `ls`, `git log` |
| editing | `Edit`, `Write`, `NotebookEdit` |
| running | `Monitor` or any other Bash command |
| browsing | `WebSearch`, `WebFetch`, browser MCP tools, or Bash like `curl`, `gh` |
| spawning | `Agent`, `Task`, `Workflow` |
| waiting | a question or permission prompt for you |
| working | any other tool, or background subagents still running |
| error | a tool call fails |
| done | the turn ends (idle after 5 s) |
| compacting | the conversation is being compacted |

The desktop app's housekeeping tools (`mcp__ccd_*`, `TodoWrite`, `Task*`) don't change the state.

**The note next to the label** is the file name for file tools, the program name only for Bash (`running make`, never its arguments), the pattern for searches, the host or query for web tools, and the description for subagents.

**Meters**
- Reset times are local clock times. The `7d` row shows a weekday, or a time when the reset is under 24 hours away.
- Narrow bands drop the `resets` part, and short ones show fewer meters, `ctx` first.
- Limit rows only appear on subscriptions that report them. On a claude.ai login the last reading is kept between sessions until a new one arrives.

**Cache countdown**
- Kept per conversation, so it survives a reload or a resume.
- Hidden while a turn runs, before a conversation's first response, and after a compaction or `/model`, which start a cold cache.
- The lifetime comes from the `cacheTtlMinutes` option (default 60), because the API doesn't say which cache tier was used.

**Subagent buddies** disappear 5 s after their last turn, when the main turn ends, or after 10 quiet minutes.

**XP rules**
- Only the main thread earns XP; subagents don't.
- A commit must succeed and not be `--amend`.
- A PR counts only when `gh pr create` prints the new PR's URL.
- A fixed test is the same test command failing, then passing, in one session.
- Thanks works in several languages: thanks, thx, cảm ơn, merci, gracias, danke, arigato, 谢谢 and more.
- Coming back means 3+ minutes idle with the cache still warm.
- Background Bash runs and calls blocked by a hook earn nothing.
- Level thresholds are `LEVELS` in `hooks/level.ts`.

</details>

## Development

```sh
claude plugin test .
claude plugin validate .
```

Work on a local clone with `claude plugin marketplace add ./my-buddy`, and run `/reload-plugins` to pick up changes.
