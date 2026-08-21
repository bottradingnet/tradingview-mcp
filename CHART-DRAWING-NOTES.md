# Chart drawing notes

Read this before marking up a chart with `draw_shape`. Everything here is a
failure this tool has actually produced, not a style preference.

## 1. Five shape names, and nothing else

`horizontal_line`, `vertical_line`, `trend_line`, `rectangle`, `text`.

TradingView accepts `createShape` with an unknown shape name without
complaining and draws nothing. Any other name silently produces an empty
chart. There is no `hline`, no `zone`, no `box`.

Two-point shapes (`trend_line`, `rectangle`) need `point2`. A rectangle drawn
with one point is not an error, it is just absent.

## 2. `point.time` is unix SECONDS, inside the loaded range

Milliseconds fail. A timestamp before the oldest loaded bar or after the newest
one fails. Both fail quietly.

Get the range first and pick a time inside it:

```
chart_get_visible_range   ->  { from, to }
time = Math.floor((from + to) / 2)
```

For a horizontal level the time value does not affect where the line sits, only
whether the call lands at all. Use a mid-range timestamp for every level and
stop thinking about it.

## 3. One shape per call, so batch

`draw_shape` draws exactly one shape. A twelve-level markup is twelve
sequential round trips over the debug channel, which is slow enough to look
broken. Put them in one `batch_run` call.

## 4. Check what actually landed

`draw_shape` returns `success: false` with `shapes_before` and `shapes_after`
when the shape count did not grow. Read that field. Do not report levels as
drawn on the strength of the call returning.

After a batch, call `draw_list` and compare `count` against the number of
shapes you meant to draw. Tell the user the real number. A markup that claims
twelve levels and delivered four is worse than one that says so.

## 5. Overrides are a JSON string, and the keys come from the chart

`overrides` is passed as a JSON **string**, not an object:

```
overrides: '{"linecolor": "#e5484d", "linewidth": 2}'
```

Override key names belong to the TradingView build that is running, and they
change between builds. Do not trust a key from memory. Confirm them once per
machine:

1. Draw one line of the kind you want by hand in TradingView, styled how you
   want it.
2. `draw_list` to get its `entity_id`.
3. `draw_get_properties` on that id. The `properties` object it returns is the
   authoritative key list for this build.

Copy the keys from step 3. That read-back is the whole point of
`draw_get_properties` existing.

The keys below are the usual Charting Library names and a reasonable first
attempt, but step 3 wins wherever they disagree:

| Purpose | Usual key |
|---|---|
| Line colour | `linecolor` |
| Line thickness | `linewidth` |
| Dashed or dotted | `linestyle` |
| Show the price label | `showLabel` |
| Label side | `horzLabelsAlign` (`left` / `center` / `right`) |
| Label vertical position | `vertLabelsAlign` (`top` / `middle` / `bottom`) |
| Label text colour | `textcolor` |
| Label size | `fontsize` |
| Rectangle outline | `color` |
| Rectangle fill | `backgroundColor`, `fillBackground`, `transparency` |

If an override key is wrong, the shape still draws, it just ignores the style.
That is a different failure from section 1 and worth telling apart: a plain
black line means the key was wrong, no line at all means section 1 or 2.

## 6. House style

Colours, so a chart reads at a glance without a legend:

| Meaning | Colour |
|---|---|
| Resistance | red `#e5484d` |
| Support | green `#30a46c` |
| Volume point of control | orange `#f5a623` |
| Moving average level | purple `#8e4ec6` |
| Macro or higher timeframe level | blue `#0091ff` |

Labels sit on the right, out of the price action, and each one carries its
reason:

```
R1  93.47  ·  today's high + Mar pivot, FIRST WALL
S2  86.10  ·  4 touches since Feb, POC edge
```

A bare number is not a level. If a line cannot say why it is there, it should
not be drawn.

Ten to twelve lines and three to five zone rectangles is the working ceiling.
Past that the chart stops being readable and the markup is decoration.

## 7. Clear before re-marking

`draw_clear` removes every shape on the chart, including ones the user drew by
hand. Ask before calling it. To replace only your own markup, keep the
`entity_id` values from your batch and remove them with `draw_remove_one`.
