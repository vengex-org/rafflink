# Agent instructions

## UI copy

Write new or changed copy in English only. Other languages fall back to English for keys they do not have yet
(list such keys in `EnglishOnlyKey` in `apps/web/src/i18n/en.ts`).

1. A field gets at most one line of help. Explanations, legal and privacy notes go behind an (i) (`InfoTip`) or
   into a `Disclosure`. Examples go into the placeholder.
2. Optional things start collapsed: official rules, bonus tickets, OBS steps, overlay style, account settings.
3. Say each thing once, at the place closest to the action it is about.
4. Use one visual system: the field spacing of `.field`, `Notice` for warnings and hints between fields, one
   section heading style, one copy field (`CopyLink`), one dialog button row.
5. Talk to the reader: "your" to the streamer, the channel name to the viewer. Keep jargon (drand, Merkle root)
   out of the main copy.
