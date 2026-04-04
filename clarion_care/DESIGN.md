# Design System Document: The Empathetic Guardian

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Concierge"**
This design system moves away from the clinical, cramped nature of traditional medical software. Instead, it adopts an **Editorial Clarity** approach—treating medication management with the dignity of a high-end magazine and the functional ease of a physical remote control. 

The system rejects the "grid-lock" of standard PWAs. It utilizes **Intentional Asymmetry** and **Gigantism** as a design language, not just an accessibility requirement. By using oversized elements and breathing room, we reduce "cognitive load" and "tappability anxiety" for seniors. The layout feels less like a computer screen and more like a series of tactile, physical cards laid out on a well-lit table.

---

## 2. Colors & Tonal Depth
Our palette is rooted in high-contrast functionality but executed with sophisticated layering to avoid a "childlike" aesthetic.

### The Temporal Palette
Each time of day is anchored by a high-chroma signature color to provide instant orientation:
*   **Morning:** `secondary_container` (#ff9800) – Warmth and clarity.
*   **Lunch/Snack:** `tertiary_container` (#42a547) – Vitality and growth.
*   **Night:** `primary_container` (#2196f3) – Calm and reliability.

### The "No-Line" Rule
**Strict Mandate:** Prohibit 1px solid borders for sectioning. 
In this design system, boundaries are defined by **Background Color Shifts**. To separate a "Morning Dosage" section from the rest of the feed, do not draw a box. Instead, place a `surface_container_highest` card onto a `surface` background. 

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of fine paper:
*   **Base:** `surface` (#fafaf1) - The foundation.
*   **Sectioning:** `surface_container_low` (#f4f4eb) - For secondary grouping.
*   **Primary Interaction:** `surface_container_highest` (#e3e3da) - For active pill cards.

### The "Glass & Gradient" Rule
To add professional polish, main action buttons (CTAs) should use a subtle vertical gradient from `primary` (#0061a4) to `primary_container` (#2196f3). For floating "Active Timer" elements, use **Glassmorphism**: `surface_variant` at 80% opacity with a `20px` backdrop blur to maintain legibility while feeling integrated into the environment.

---

## 3. Typography
We utilize a dual-typeface system to balance authority with approachability.

*   **Display & Headlines (Lexend):** Chosen for its hyper-legibility and expanded character width. 
    *   *Role:* Editorial impact and immediate "At-a-glance" status.
    *   *Scale:* `display-lg` (3.5rem) for time-of-day headers; `headline-lg` (2rem) for medication names.
*   **Body & Labels (Public Sans):** A neutral, industrial sans-serif that remains legible even at heavy weights.
    *   *Role:* Instructional text and secondary data.
    *   *Scale:* `title-lg` (1.375rem) is our "Standard" body size. **Nothing in this system should fall below 1rem (`body-lg`) for senior accessibility.**

---

## 4. Elevation & Depth
We eschew the "flat" look of 2010s web design in favor of **Tonal Layering**.

*   **The Layering Principle:** Instead of shadows, move from `surface_container_lowest` for the most background elements to `surface_container_highest` for the most foreground elements.
*   **Ambient Shadows:** If a card must "float" (e.g., a critical alert), use an ultra-diffused shadow: `box-shadow: 0 20px 40px rgba(26, 28, 23, 0.08)`. The shadow is tinted with the `on_surface` color to feel natural.
*   **The Ghost Border:** For input fields only, use the `outline_variant` token at **20% opacity**. It should be a hint of a container, not a cage.

---

## 5. Components

### Giant Buttons (The "Touch-First" Standard)
*   **Height:** Minimum 80px.
*   **Corner Radius:** `xl` (1.5rem) for a friendly, organic feel.
*   **Primary:** Gradient of `primary` to `primary_container`. Text: `on_primary`.
*   **States:** On `pressed`, scale down to 98% to provide tactile haptic feedback.

### Pill Progress Cards
*   **Structure:** No dividers. Use a `surface_container_high` background.
*   **Visual Cue:** Use a thick (12px) vertical "Status Bar" on the left edge of the card using the Temporal Palette (e.g., Yellow for Morning) to categorize the entry.

### Input Fields
*   **Styling:** Background-filled using `surface_variant`. No bottom line.
*   **Typography:** All labels use `headline-sm` to ensure the user never loses their place while typing.

### Chips (Action & Filter)
*   **Sizing:** Minimum 64px height.
*   **Icons:** Every icon must be paired with a `label-md` or `title-sm` text element. Icons should never stand alone.

---

## 6. Do's and Don'ts

### Do
*   **DO** use white space as a structural element. If elements feel too close, double the padding.
*   **DO** use high-contrast pairings (e.g., `on_primary_container` on `primary_container`).
*   **DO** provide haptic or visual feedback for every tap—seniors need to know the "machine" heard them.
*   **DO** use `headline-lg` for "Yes/No" or "Confirm/Cancel" choices to minimize errors.

### Don't
*   **DON'T** use 1px dividers. They create visual noise and "clutter" for users with declining vision.
*   **DON'T** use "X" to close a modal. Use a giant button that says "CLOSE" or "BACK."
*   **DON'T** use pure black (#000000). Use `on_surface` (#1a1c17) for a softer, premium high-contrast look that is easier on the eyes over long periods.
*   **DON'T** hide important actions behind "hamburger" menus. If it's important, it should be a giant button on the screen.