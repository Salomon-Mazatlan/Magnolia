# Manual screenshots

Put screenshots and other images for the manual in this folder.

## Referencing an image

From any page in `guide/`, link to an image with a **relative** path:

```markdown
![A description of the screenshot](./images/coding-interface.png)
```

The text in the square brackets is the alt text — write a real description; it's
shown if the image fails to load and read aloud by screen readers.

VitePress automatically optimizes and cache-busts these images when the site is
built, so relative paths (`./images/…`) are preferred over absolute ones.

## Centring a screenshot

A markdown image **on its own line** (a blank line above and below) is
automatically centred and given a subtle frame:

```markdown
Here is the coding view:

![The coding interface](./images/coding-interface.png)

You can apply codes by selecting text.
```

### With a caption

Use a `<figure>` when you want a caption under the image (relative paths work
here too):

```markdown
<figure>
  <img src="./images/query-builder.png" alt="The graphical query builder">
  <figcaption>The query builder, with code nodes on the canvas.</figcaption>
</figure>
```

(The centring, frame, and caption styling live in
`.vitepress/theme/custom.css`.)

## Putting an image inside a numbered step

This is the one thing to get right. An image inside a list **must be indented**
to line up under the step's text, with a **blank line** above and below it.
Otherwise Markdown breaks the list — the numbering restarts and later steps can
disappear entirely.

✅ **Correct** — figure indented 3 spaces (under the text, not the number), blank
lines around it:

```markdown
1. Select the text you want to code.

2. Drag a code onto it.

   <figure>
     <img src="./images/coded-text.png" alt="Coded text">
     <figcaption>Text with a code applied.</figcaption>
   </figure>

3. Repeat for the next passage.
```

❌ **Wrong** — figure flush to the left margin. Markdown ends the list here, so
step 3 is swallowed and the numbering breaks:

```markdown
2. Drag a code onto it.
<figure>
  <img src="./images/coded-text.png" alt="Coded text">
</figure>
3. Repeat for the next passage.
```

The same applies to plain Markdown images (`![alt](./images/x.png)`) inside a
step — indent them 3 spaces with blank lines around them.

## Tips

- Use clear, lowercase, hyphenated file names: `query-builder.png`, not
  `Screenshot 2026-06-18 at 14.03.png`.
- PNG is best for UI screenshots; JPG for photos.
- Keep images reasonably sized (roughly 2000px wide is plenty) so pages stay fast.
