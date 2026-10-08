# Receipt PDF: later pages

The receipt reader sends each PDF page as its own image. A file of up to 8 pages is read whole. A longer file sends page 1 plus the last 7 pages, because the amount due is often after the line items.

The saved receipt image still keeps the first two pages only. Reading is separate from that stored copy.

Build `2026-10-08.6`. Service worker comment v18.
