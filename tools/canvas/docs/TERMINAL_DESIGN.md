# Terminal design read

Draft without direction. ENERGY 1 / RHYTHM 1 / MOTION 1.

Reading this as: a dense operational canvas for developers, using native
terminal hierarchy and restrained status color, dial ENERGY 1 / RHYTHM 1 /
MOTION 1.

- Color: green, yellow, and red are reserved for connection state because the
  meaning is conventional and immediately scannable in a terminal.
- Layout: one header, one scrollable document, and one trusted decision area
  keep document-controlled content separate from authority-bearing controls.
- Typography: the terminal's own font is used because cell width is the layout
  unit and the application cannot safely choose a host typeface.
- Spacing: compact vertical spacing favors logs, plans, and structured data in
  a 40 percent side pane.
- Framing: single-line borders appear only around trusted decisions so users
  can distinguish them from MDX content.
- Motion: no decorative motion is used; worker timers may update data, but the
  trusted shell remains visually stable.
