# startit rooms

A meeting room booking board for a shared office. Built for the startit incubator in Budapest, where four meeting rooms used to be booked in a shared Excel sheet.

No sign-in, no accounts. Open the link, see every room for the day, book.

## What it does

- **Room grid:** the four rooms side by side, by the hour, for any day of the week. Live: every open screen updates as soon as someone books.
- **Book on the grid:** click a free slot to drop a dashed draft. Drag it to move it (even to another room), drag its top or bottom edge to change the time, add your company and optionally an email, then Book.
- **Book a room:** a button that opens a form instead of the grid. Pick a day, time and room. Busy rooms say who has them and offer the next free time of the same length.
- **No double-booking:** overlaps are blocked in the browser and again on the server.
- **Edit and delete:** tap a booking to see its details, then Edit (drag it, or change day, room and times in the panel) or Delete.
- **Colors:** each booking has a color, picked from 30 presets next to the company name.
- **Undo:** every booking, edit and delete has an Undo toast.
- Your company, email and color are remembered in your browser. Anyone with the link can edit or delete any booking, like a shared spreadsheet.

## Run it

Needs Node 20 or newer.

```bash
npm install
npm run build
npm start            # http://localhost:8787
```

While developing: `npm run dev` (API on 8787, app with hot reload on 5174).

## How it works

- `server.js`: Node, no dependencies. Stores bookings in `data/bookings.json` (set `DATA_FILE` to move it), rejects overlaps, and pushes changes to every open screen with Server-Sent Events.
- `src/App.tsx`: the room grid, drafts, editing and panels.
- `src/forms.tsx`: the company/email/color fields and the "Book a room" form.
- `src/pickers.tsx`: the day calendar and the time and room pickers.
- `src/rooms.ts`: rooms, opening hours (07:00–22:00, 15-minute steps) and the color palette. Keep rooms and hours in sync with `server.js`.
- `src/cargo/`: components and design tokens from the Cargo UI library (TextField, Segmented, UndoToast).

To use it for your own office, change `ROOMS` in `src/rooms.ts` and in `server.js`.

## Hosting

Any host that runs one Node process with a persistent disk works: a small VPS, Railway or Render with a volume, or a computer in the office. Run `npm run build && npm start` and keep the `data/` folder on persistent storage.

Serverless hosts such as Vercel need a database and a realtime service instead of `server.js` (for example Supabase).

## License

MIT, see [LICENSE](LICENSE).
