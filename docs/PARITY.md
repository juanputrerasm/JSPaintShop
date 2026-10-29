# Parity with PSP 6.02

Every menu item, tool, palette, dialog and file format of PSP 6.02, and where JSPaintShop stands on it. Statuses:

- **Ported**: works as in PSP 6.
- **Changed**: works, differently (the reason is given).
- **Added**: not in PSP 6.
- **Not ported**: listed but greyed out (the reason is given).
- **Removed**: left out of the menus: the original vendor's links and companion programs, and what a browser cannot do.
- **Not yet**: listed and greyed out, still to do.

The box is ticked by hand after checking the item against PSP 6 in a browser.

## File menu

| | Item | Status |
|---|---|---|
| [ ] | New... (Ctrl+N) | Ported: the dialog and its lists from DIALOG 706; PSP's first defaults (registry NewImage: 300 x 300, 72 dpi, background color, 16.7 million colors), then the last values are remembered |
| [ ] | Open... (Ctrl+O) | Changed: the browser's file chooser; several files at once; the formats in the File formats section (RAW asks its options, with a palette chosen alongside) |
| [ ] | Browse... (Ctrl+B) | Changed: a folder from the browser's folder picker (read-only listing without it); thumbnails at Preferences > Browser's size; the Browser menu (MENU 130) with Select, Sort, Find, Copy To, Move To, Delete, Rename, Information, Open; no drive tree and no thumbnail cache files |
| [ ] | Close | Ported: asks to save changes |
| [ ] | Revert... | Ported where the browser gives file handles (Chromium); greyed elsewhere |
| [ ] | Save (Ctrl+S) | Changed: writes back to the file where the browser allows it, else works as Save As |
| [ ] | Save As... (F12) | Changed: the browser's save dialog, or a download with a name and type dialog; the formats marked Yes under Save in the File formats section |
| [ ] | Save Copy As... (Ctrl+F12) | Changed: as Save As |
| [ ] | Delete (Ctrl+Del) | Ported where the browser can remove files (Chromium's FileSystemHandle.remove); greyed elsewhere |
| [ ] | Send... | Changed: the browser's share sheet with the image as PNG (PSP 6 uses the mail client); greyed where the browser cannot share files |
| [ ] | Import > TWAIN > Acquire... | Removed: browsers cannot reach scanners or camera drivers; File > Import now holds Picture Tubes |
| [ ] | Import > TWAIN > Select Source... | Removed: browsers cannot reach scanners or camera drivers; File > Import now holds Picture Tubes |
| [ ] | Import > Digital Camera > Access... | Removed: browsers cannot reach scanners or camera drivers; File > Import now holds Picture Tubes |
| [ ] | Import > Digital Camera > Configure... | Removed: browsers cannot reach scanners or camera drivers; File > Import now holds Picture Tubes |
| [ ] | Import > Picture Tubes... | Added: copies chosen .tub files into the browser's storage for the Picture Tube tool |
| [ ] | Import > Picture Frames... | Added: .pfr files for Picture Frame |
| [ ] | Import > Gradients... | Added: .jgd files for the gradient lists |
| [ ] | Import > Patterns... | Added: .pat (BMP) or other image files for pattern fills |
| [ ] | Import > Textures... | Added: .tex (greyscale BMP) or other image files for paper textures, Texture and Sculpture |
| [ ] | Import > User Defined Filters... | Added: a .flt file (PSP 6's pspud.flt), checked before it replaces the current filters |
| [ ] | Export > Picture Tube... | Ported: saves into the tubes library (a PSP 6 file with the tube block) |
| [ ] | Export > Transparent GIF... | Ported: the wizard's five pages; the quality slider's nine color counts from Psp.exe (0x922b9c) |
| [ ] | Export > JPEG File... | Changed: the wizard's pages; Progressive is greyed (the browser writes baseline JPEG only) |
| [ ] | Export > StudioAvenue.com... | Removed: a closed online service of the original vendor; not in the menu |
| [ ] | Export > Export plug-ins | Removed: Photoshop plug-ins cannot run in a browser |
| [ ] | Page Setup... | Changed: paper, orientation, centre or margins, scale, fit to page, color or greyscale, negative, background; CMYK Separations greyed; the printer is chosen in the browser's print dialog |
| [ ] | Print Preview | Ported: the page as it will print, with Print and Setup |
| [ ] | Print... (Ctrl+P) | Changed: crop marks, registration marks, title, copies; then the browser's print dialog |
| [ ] | Print Multiple Images... | Changed: the open images laid out in a grid on one page (PSP 6 opens a layout window where they are placed by hand) |
| [ ] | Batch Conversion... | Ported: files from the file picker, output type and JPEG options, stop on error, output folder (or downloads), Batch Progress with log, Abort and Save Log |
| [ ] | Run Image Robot | Removed: a separate program of the original vendor; not in the menu |
| [ ] | Run Animation Shop | Removed: a separate program; not in the menu |
| [ ] | Preferences > General Program Preferences... | Ported: the eight tabs with PSP 6's defaults from its registry loader; Undo (steps, redo), Viewing (auto size), Miscellaneous (recent files, paste tolerance), Rulers and Units (grid), Cursors and Transparency take effect; the disk limit and the Browser cache options are kept but have no effect |
| [ ] | Preferences > CMYK Conversion Preferences... | Removed: no color management profiles in the browser |
| [ ] | Preferences > File Format Preferences... | Removed: its tabs (PCD, WMF, FITS import) belong to formats that are not ported |
| [ ] | Preferences > File Format Associations... | Removed: browsers do not register file types this way |
| [ ] | Preferences > Customize Toolbar... | Ported: the Windows toolbar Customize dialog: add, remove, move, reset |
| [ ] | Preferences > Color Management... | Removed: the browser manages display color |
| [ ] | Preferences > Monitor Gamma... | Removed: the browser manages display color |
| [ ] | Recent files | Changed: Preferences > Miscellaneous sets how many (4 by default); reopening needs a browser with file handles (Chromium) |
| [ ] | Exit | Changed: closes every image, asking about unsaved ones; the browser closes the tab |

## Edit menu

| | Item | Status |
|---|---|---|
| [ ] | Undo (Ctrl+Z) | Ported |
| [ ] | Redo (Ctrl+Alt+Z) | Ported |
| [ ] | Command History... (Shift+Ctrl+Z) | Ported |
| [ ] | Cut (Ctrl+X) | Ported |
| [ ] | Copy (Ctrl+C) | Ported |
| [ ] | Copy Merged (Shift+Ctrl+C) | Ported |
| [ ] | Paste > As New Image | Ported: from the system clipboard; the browser asks permission the first time |
| [ ] | Paste > As New Layer (Ctrl+L) | Ported |
| [ ] | Paste > As New Selection (Ctrl+E) | Ported |
| [ ] | Paste > As Transparent Selection (Shift+Ctrl+E) | Ported |
| [ ] | Paste > Into Selection (Shift+Ctrl+L) | Ported |
| [ ] | Paste > AS2 Animation as Multiple Images | Removed: belongs to Animation Shop; not in the menu |
| [ ] | Paste > As New Vector Selection (Ctrl+G) | Ported: pastes vector objects copied in JSPaintShop (the system clipboard has no PSP vector format), on a new vector layer if needed |
| [ ] | Clear (Del) | Ported |
| [ ] | Update Back to Animation Shop | Removed: belongs to Animation Shop; not in the menu |
| [ ] | Empty > Clipboard | Ported |
| [ ] | Empty > Command History | Ported |

## View menu

| | Item | Status |
|---|---|---|
| [ ] | Full Screen Edit (Shift+A) | Changed: the browser's full screen |
| [ ] | Full Screen Preview (Shift+Ctrl+A) | Ported |
| [ ] | Normal Viewing (1:1) (Ctrl+Alt+N) | Ported |
| [ ] | Zoom In By 1 | Ported |
| [ ] | Zoom In By 5 | Ported |
| [ ] | Zoom Out By 1 | Ported |
| [ ] | Zoom Out By 5 | Ported |
| [ ] | Image Information... (Shift+I) | Ported: Image Information and Creator Information pages; the Watermark page is left out with Digimarc |
| [ ] | Grid (Ctrl+Alt+G) | Ported: spacing 10 pixels until Preferences |
| [ ] | Rulers | Ported: in pixels until Preferences |
| [ ] | ToolBars... | Ported: the checklist, "large text and icons" and "Enable Automatic Roll-Ups" (on by default, as in PSP: floating palettes roll up to their title bar when the pointer and focus leave, each with a Lock Window Open pin that keeps it open, remembered between sessions); flat style is always on |

## Image menu

| | Item | Status |
|---|---|---|
| [ ] | Flip (Ctrl+I) | Ported |
| [ ] | Mirror (Ctrl+M) | Ported |
| [ ] | Rotate... (Ctrl+R) | Ported |
| [ ] | Add Borders... | Ported |
| [ ] | Crop to Selection (Shift+R) | Ported |
| [ ] | Canvas Size... | Ported |
| [ ] | Resize... (Shift+S) | Ported: PSP's Resize Type order and rules (section 4): Smart size by the axis that changes most, Bilinear the box filter, Bicubic PSP's MMX bicubic, Pixel resize jff.dll's integer scale; paletted images only pixel resize; layer masks resized with the layers; without Resize All Layers the layer's contents resize about their center |
| [ ] | Arithmetic... | Ported |
| [ ] | Deformations > Deformation Browser... | Ported: the list with a sample preview on a small copy of the layer at default settings; OK runs the chosen deformation |
| [ ] | Deformations > Circle | Ported |
| [ ] | Deformations > Cylinder - Horizontal... | Ported |
| [ ] | Deformations > Cylinder - Vertical... | Ported, mirroring Horizontal (its amounts assumed) |
| [ ] | Deformations > CurlyQs... | Ported |
| [ ] | Deformations > Pentagon | Ported: PSP's sizes, edge slopes, inside test (with its blank top row at even widths) and area resampling (section 9) |
| [ ] | Deformations > Perspective - Horizontal... | Ported |
| [ ] | Deformations > Perspective - Vertical... | Ported as the transpose of Horizontal |
| [ ] | Deformations > Pinch... | Ported |
| [ ] | Deformations > Punch... | Ported |
| [ ] | Deformations > Ripple... | Ported |
| [ ] | Deformations > Rotating Mirror... | Ported |
| [ ] | Deformations > Skew... | Ported: PSP's per-line spans (section 9) |
| [ ] | Deformations > Spiky Halo... | Ported; the dialog's labels are inferred |
| [ ] | Deformations > Twirl... | Ported |
| [ ] | Deformations > Warp... | Ported |
| [ ] | Deformations > Wave... | Ported |
| [ ] | Deformations > Wind... | Ported |
| [ ] | Effects > Black Pencil... | Ported |
| [ ] | Effects > Blinds... | Ported |
| [ ] | Effects > Buttonize... | Ported on layers without transparency (transparent layers keep their alpha); works on the selection's bounding box |
| [ ] | Effects > Charcoal... | Ported |
| [ ] | Effects > Chisel... | Ported, with PSP's handling of the band's first and last rows |
| [ ] | Effects > Chrome... | Ported: Flaws 1-8, Brightness 0-100 (0x5d07a0) |
| [ ] | Effects > Colored Chalk... | Ported |
| [ ] | Effects > Colored Pencil... | Ported |
| [ ] | Effects > Cutout... | Ported: color and selection only; a layer's transparency is left as it is, as PSP's routine does |
| [ ] | Effects > Drop Shadow... | Ported: PSP's mask blur and blending, both the background and the transparent-layer paths |
| [ ] | Effects > Feedback... | Ported, with PSP's elliptical test (focal-distance sums against each step's and the first step's ellipse) |
| [ ] | Effects > Glowing Edges... | Ported |
| [ ] | Effects > Inner Bevel... | Ported: the Bevel list shows each shape's profile picture, drawn as PSP draws them (0x5d72b0) |
| [ ] | Effects > Kaleidoscope... | Ported: the sampler's edge mode 3 with black, as PSP sets it |
| [ ] | Effects > Mosaic - Antique... | Ported; Symmetric copies the columns to the rows |
| [ ] | Effects > Mosaic - Glass... | Ported; Symmetric copies the columns to the rows |
| [ ] | Effects > Neon Glow... | Ported, including PSP's mixed-up channel taps |
| [ ] | Effects > Outer Bevel... | Ported; as Inner Bevel |
| [ ] | Effects > Pattern... | Ported; as Kaleidoscope for edges |
| [ ] | Effects > Sculpture... | Ported; patterns from the imported resources or a solid color (PSP's default gold) |
| [ ] | Effects > Texture... | Ported; textures come from the imported PSP 6 resources; resizing for Size % uses JSPaintShop's smart resize |
| [ ] | Effects > Tiles... | Ported: PSP's tessellations and grid sizes from the bottom left, angularity snapping, tile colors under the shrunk tile, its 3x antialiased drawing, bevel and lighting (section 17); greyscale images take PSP's 8-bit path |
| [ ] | Effects > Weave... | Ported: the per-column shading inside strand rows follows the row formulas; first-run defaults from the constructor (gap 25, width 75) |
| [ ] | Watermarking > Embed Watermark... | Removed: Digimarc watermarks are proprietary |
| [ ] | Watermarking > Read Watermark... | Removed: Digimarc watermarks are proprietary |
| [ ] | Picture Frame... | Changed: the wizard is one dialog; frames come from the imported Frames folder. The hole, borders and white edge color are PSP's (section 10), with the frame's last alpha channel as its shape |
| [ ] | Filter Browser... | Ported: as the Deformation Browser; user defined filters are not listed yet |
| [ ] | Blur > Blur | Ported: kernel code 10 (5 x 5, divisor 44) |
| [ ] | Blur > Blur More | Ported: kernel code 11 |
| [ ] | Blur > Gaussian Blur... | Ported: PSP's integer weights and passes, its rounding fix-up included; default radius 1 |
| [ ] | Blur > Motion Blur... | Ported: PSP's 8.8 fixed-point steps; defaults angle 0, intensity 4; angle 0-359, intensity 1-40 (0x5cd3f0) |
| [ ] | Blur > Soften | Ported: kernel code 30 |
| [ ] | Blur > Soften More | Ported: kernel code 31 |
| [ ] | Edge > Enhance | Ported: kernel code 50 |
| [ ] | Edge > Enhance More | Ported: kernel code 51 |
| [ ] | Edge > Find All | Ported: kernel code 61 |
| [ ] | Edge > Find Horizontal | Ported: kernel code 62 |
| [ ] | Edge > Find Vertical | Ported: kernel code 63 |
| [ ] | Edge > Trace Contour | Ported: kernel code 40 (bias 255) |
| [ ] | Noise > Add... | Ported: PSP's rand() sequence; defaults Random, 50 % |
| [ ] | Noise > Despeckle | Ported |
| [ ] | Noise > Median Cut | Ported: the 3 x 3 median |
| [ ] | Sharpen > Sharpen | Ported: kernel code 20 |
| [ ] | Sharpen > Sharpen More | Ported: kernel code 21 |
| [ ] | Sharpen > Unsharp Mask... | Ported: defaults radius 2, strength 100, clipping 5 |
| [ ] | Other > Dilate | Ported |
| [ ] | Other > Emboss | Ported: kernel code 1 |
| [ ] | Other > Erode | Ported |
| [ ] | Other > Hot Wax Coating | Ported: uses the foreground color |
| [ ] | Other > Mosaic... | Ported: defaults 1 x 1, symmetric, as PSP's constructor sets them |
| [ ] | User Defined Filters... | Ported: pspud.flt in PSP 6's own format (imported, edited and saved back), 7 x 7 matrix, division factor, bias |

## Colors menu

| | Item | Status |
|---|---|---|
| [ ] | Adjust > Brightness/Contrast... (Shift+B) | Ported |
| [ ] | Adjust > Gamma Correction... (Shift+G) | Ported |
| [ ] | Adjust > Highlight/Midtone/Shadow... (Shift+M) | Ported |
| [ ] | Adjust > Hue/Saturation/Lightness... (Shift+H) | Ported |
| [ ] | Adjust > Hue Map... | Ported |
| [ ] | Adjust > Red/Green/Blue... (Shift+U) | Ported |
| [ ] | Colorize... (Shift+L) | Ported |
| [ ] | Grey Scale | Ported |
| [ ] | Histogram Functions > Equalize (Shift+E) | Ported |
| [ ] | Histogram Functions > Stretch (Shift+T) | Ported |
| [ ] | Negative Image | Ported |
| [ ] | Posterize... (Shift+Z) | Ported |
| [ ] | Solarize... | Ported |
| [ ] | Channel Splitting > Split to RGB | Ported |
| [ ] | Channel Splitting > Split to HSL | Ported |
| [ ] | Channel Splitting > Split to CMYK | Ported |
| [ ] | Channel Combining > Combine from RGB... | Ported |
| [ ] | Channel Combining > Combine from HSL... | Ported |
| [ ] | Channel Combining > Combine from CMYK... | Ported |
| [ ] | Edit Palette... (Shift+P) | Ported |
| [ ] | Load Palette... (Shift+O) | Ported |
| [ ] | Save Palette... | Ported |
| [ ] | Set Palette Transparency... (Shift+Ctrl+V) | Ported: none, the background color, or a palette entry; turns View Palette Transparency on; GIF and PNG save it, and a transparent GIF opens with it set |
| [ ] | View Palette Transparency (Shift+V) | Ported: the transparent entry's color shows the checkerboard |
| [ ] | Count Colors Used | Ported |
| [ ] | Decrease Color Depth > 2 Colors (1 bit)... (Shift+Ctrl+1) | Ported: enabled above 1 bit, as PSP |
| [ ] | Decrease Color Depth > 16 Colors (4 bit)... (Shift+Ctrl+2) | Ported: median cut, octree or Windows' colors; nearest, PSP's ordered dither (Windows' colors) or error diffusion; boost marked colors, reduce color bleeding; the palette always has 16 entries; enabled on 8- and 24-bit images (section 5) |
| [ ] | Decrease Color Depth > 256 Colors (8 bit)... (Shift+Ctrl+3) | Ported: PSP's median cut, octree and web cube; nearest color, its 16 x 16 ordered dither (web cube) and Floyd-Steinberg shares; boost marked colors, Windows' colors, reduce color bleeding; the palette always has 256 entries (black past the image's colors); enabled on 24-bit images only, as PSP (section 5) |
| [ ] | Decrease Color Depth > 32K Colors (24 bit) ... (Shift+Ctrl+4) | Ported: enabled on 24-bit images |
| [ ] | Decrease Color Depth > 64K Colors (24 bit)... (Shift+Ctrl+5) | Ported: enabled on 24-bit images |
| [ ] | Decrease Color Depth > X Colors (4/8 bit)... (Shift+Ctrl+6) | Ported: as 256 Colors without ordered dither (DIALOG 180); the standard palette is the web cube whatever the count; 4 bits for 16 colors or fewer, else 8 |
| [ ] | Increase Color Depth > 16 Colors (4 bit) (Shift+Ctrl+8) | Ported: the indexes stay and the palette grows to 16 entries, black after the old colors (section 5) |
| [ ] | Increase Color Depth > 256 Colors (8 bit) (Shift+Ctrl+9) | Ported: the indexes stay and the palette grows to 256 entries, black after the old colors (section 5) |
| [ ] | Increase Color Depth > 16 Million Colors (24 bit) (Shift+Ctrl+0) | Ported |

## Layers menu

| | Item | Status |
|---|---|---|
| [ ] | New Raster Layer... | Ported |
| [ ] | New Vector Layer... | Ported |
| [ ] | New Adjustment Layer > Brightness/Contrast... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Channel Mixer... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Color Balance... | Ported: PSP's table builder, with and without Preserve Luminosity (section 13); the three tone groups show together instead of PSP's Tone balance buttons |
| [ ] | New Adjustment Layer > Curves... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Hue/Saturation... | Ported: master and the six hue ranges, Colorize starting at the foreground's hue, PSP's per-degree tables and pixel routine (section 13); the range bounds keep PSP's defaults |
| [ ] | New Adjustment Layer > Invert... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Levels... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Posterize... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Threshold... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | Duplicate | Ported |
| [ ] | Delete | Ported |
| [ ] | Properties... | Ported |
| [ ] | Matting > Defringe... | Ported |
| [ ] | Matting > Remove Black Matte | Ported |
| [ ] | Matting > Remove White Matte | Ported |
| [ ] | Arrange > Bring to Top | Ported |
| [ ] | Arrange > Move Up | Ported |
| [ ] | Arrange > Move Down | Ported |
| [ ] | Arrange > Send to Bottom | Ported |
| [ ] | View > Current Only | Ported |
| [ ] | View > All | Ported |
| [ ] | Merge > Merge All (Flatten) | Ported |
| [ ] | Merge > Merge Visible | Ported |
| [ ] | Convert to Raster | Ported |
| [ ] | Layer list (Ctrl+1..9) | Ported |

## Selections menu

| | Item | Status |
|---|---|---|
| [ ] | Select All (Ctrl+A) | Ported |
| [ ] | Select None (Ctrl+D) | Ported |
| [ ] | From Mask (Shift+Ctrl+S) | Ported |
| [ ] | Invert (Shift+Ctrl+I) | Ported |
| [ ] | Matting > Defringe... | Ported |
| [ ] | Matting > Remove Black Matte | Ported |
| [ ] | Matting > Remove White Matte | Ported |
| [ ] | Modify > Contract... | Ported |
| [ ] | Modify > Expand... | Ported |
| [ ] | Modify > Feather... (Ctrl+H) | Ported |
| [ ] | Modify > Grow Selection | Ported |
| [ ] | Modify > Select Similar | Ported |
| [ ] | Modify > Transparent Color... (Ctrl+T) | Ported |
| [ ] | Hide Marquee (Shift+Ctrl+M) | Ported |
| [ ] | Convert to Seamless Pattern | Ported |
| [ ] | Promote To Layer (Shift+Ctrl+P) | Ported |
| [ ] | Load From Disk... | Ported |
| [ ] | Load From Alpha Channel... | Ported |
| [ ] | Save To Disk... | Ported |
| [ ] | Save To Alpha Channel... | Ported |
| [ ] | Float (Ctrl+F) | Ported |
| [ ] | Defloat (Shift+Ctrl+F) | Ported |

## Masks menu

| | Item | Status |
|---|---|---|
| [ ] | New > Hide All (Shift+Y) | Ported |
| [ ] | New > Show All | Ported |
| [ ] | New > Hide Selection | Ported |
| [ ] | New > Show Selection | Ported |
| [ ] | New > From Image... | Ported |
| [ ] | Delete | Ported |
| [ ] | Invert (Shift+K) | Ported |
| [ ] | Edit (Ctrl+K) | Ported |
| [ ] | View Mask (Ctrl+Alt+V) | Ported |
| [ ] | Load From Disk... | Ported |
| [ ] | Load From Alpha Channel... | Ported |
| [ ] | Save To Disk... | Ported |
| [ ] | Save To Alpha Channel... | Ported |

## Capture menu (removed)

| | Item | Status |
|---|---|---|
| [ ] | Setup... | Removed with the Capture menu: browsers cannot capture other programs' windows |
| [ ] | Start (Shift+C) | Removed with the Capture menu: browsers cannot capture other programs' windows |

## Window menu

| | Item | Status |
|---|---|---|
| [ ] | New Window (Shift+W) | Ported: titles numbered ":2", ":3" as MFC does |
| [ ] | Cascade | Ported |
| [ ] | Tile Horizontally | Ported |
| [ ] | Tile Vertically | Ported |
| [ ] | Close All | Ported |
| [ ] | Duplicate (Shift+D) | Ported |
| [ ] | Fit to Image (Ctrl+W) | Ported |

## Help menu

| | Item | Status |
|---|---|---|
| [ ] | Tip of the Day... | Removed: PSP's WinHelp and Tips.txt are not shown in the browser port (F1 and Shift+F1 are gone too) |
| [ ] | Help Topics... | Removed: PSP's WinHelp and Tips.txt are not shown in the browser port (F1 and Shift+F1 are gone too) |
| [ ] | How Do I... | Removed: PSP's WinHelp and Tips.txt are not shown in the browser port (F1 and Shift+F1 are gone too) |
| [ ] | (vendor) Online > Web Site, Support Pages, Digital Studio, StudioAvenue, Check for Updates, Email Technical Support | Removed: the vendor's sites are gone; the submenu is not in the menu |
| [ ] | About JSPaintShop... | Changed: JSPaintShop's own icon, version and license |

## Tools

| | Item | Status |
|---|---|---|
| [ ] | Arrow | Ported: clicking a window brings it forward, dragging scrolls the image |
| [ ] | Zoom | Ported: left-click zooms in, right-click out, at the pointer |
| [ ] | Deformation | Ported: corners, sides (Shift skews), Ctrl+corner perspective, rotation bar, move; Apply/Enter/double-click warps with PSP's bilinear apply (section 12), Cancel/Escape drops; the box is outlined while dragging, the pixels move on Apply |
| [ ] | Crop | Ported |
| [ ] | Mover | Ported |
| [ ] | Selection | Ported |
| [ ] | Freehand | Ported |
| [ ] | Magic Wand | Ported |
| [ ] | Dropper | Ported |
| [ ] | Paint Brush | Ported |
| [ ] | Clone Brush | Ported |
| [ ] | Color Replacer | Ported |
| [ ] | Retouch | Ported: PSP's kernels, HLS shifts and blend-mode painting (section 20). Added: right-click turns paired modes around (Lighten and Darken, Dodge and Burn, up and down) |
| [ ] | Eraser | Ported |
| [ ] | Picture Tube | Ported: tubes from the imported Tubes folder; PSP's placement and selection modes; Scale resamples the cells; the Tool Options picture shows the tube |
| [ ] | Airbrush | Ported |
| [ ] | Flood Fill | Ported |
| [ ] | Text | Changed: Text Entry dialog with the browser's fonts; Create as vector, selection or floating as Tool Options say |
| [ ] | Draw | Ported: Single Line, Bezier Curve, Freehand, Point to Point; caps and joins as PSP's picture buttons, miter, width, antialias, Stroked/Filled |
| [ ] | Preset Shapes | Ported: PSP's shape node data (section 14). Added: a picture of the chosen shape in Tool Options |
| [ ] | Vector Object Selection | Ported: click, Shift adds, Ctrl removes; drag moves, corners resize; right-click menu; Node Edit shows and drags nodes |

## Histogram context menu

| | Item | Status |
|---|---|---|
| [ ] | Red Channel | Changed: a check box in the Histogram window instead of its context menu |
| [ ] | Green Channel | Changed: a check box in the Histogram window instead of its context menu |
| [ ] | Blue Channel | Changed: a check box in the Histogram window instead of its context menu |
| [ ] | Luminance | Changed: a check box in the Histogram window instead of its context menu |

## Brush context menu

| | Item | Status |
|---|---|---|
| [ ] | Normal | Ported |
| [ ] | Custom... | Ported |
| [ ] | Paintbrush | Ported |
| [ ] | Pen | Ported |
| [ ] | Pencil | Ported |
| [ ] | Marker | Ported |
| [ ] | Crayon | Ported |
| [ ] | Chalk | Ported |
| [ ] | Charcoal | Ported |

## Layer context menu

| | Item | Status |
|---|---|---|
| [ ] | New Raster Layer... | Ported |
| [ ] | New Vector Layer... | Ported |
| [ ] | New Adjustment Layer > Brightness/Contrast... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Channel Mixer... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Color Balance... | Ported: PSP's table builder, with and without Preserve Luminosity (section 13); the three tone groups show together instead of PSP's Tone balance buttons |
| [ ] | New Adjustment Layer > Curves... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Hue/Saturation... | Ported: master and the six hue ranges, Colorize starting at the foreground's hue, PSP's per-degree tables and pixel routine (section 13); the range bounds keep PSP's defaults |
| [ ] | New Adjustment Layer > Invert... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Levels... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Posterize... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Threshold... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | Duplicate | Ported |
| [ ] | Delete | Ported |
| [ ] | Properties... | Ported |
| [ ] | View > Current Only | Ported |
| [ ] | View > All | Ported |
| [ ] | Merge > Merge All (flatten) | Ported |
| [ ] | Merge > Merge Visible | Ported |
| [ ] | Convert to Raster | Ported |
| [ ] | Promote To Layer | Ported |
| [ ] | Defloat | Ported |

## Shape select context menu

| | Item | Status |
|---|---|---|
| [ ] | Cut | Ported |
| [ ] | Copy | Ported |
| [ ] | Delete | Ported |
| [ ] | Arrange > Bring to Top | Ported |
| [ ] | Arrange > Move Up | Ported |
| [ ] | Arrange > Move Down | Ported |
| [ ] | Arrange > Send to Bottom | Ported |
| [ ] | Properties... | Ported |
| [ ] | Select All | Ported |
| [ ] | Select None | Ported |
| [ ] | Fit Text to Path | Ported: one text and one path selected; PSP's placement along the path's first contour, past its ends on open paths, centred on the top, left or right of closed ones (section 15); the advances come from the browser's fonts |
| [ ] | Convert Text to Curves > As Single Shape | Changed: the text is traced from a 4x drawing (browsers give no glyph outlines) |
| [ ] | Convert Text to Curves > As Character Shapes | Changed: each character traced on its own |
| [ ] | Node Edit | Ported |

## Node edit context menu

| | Item | Status |
|---|---|---|
| [ ] | Mode Toggle (Ctrl+E) | Ported: switches Node Edit between Edit mode and Drawing mode; in Drawing mode a click extends the contour from its selected start or end node or starts a new contour, and dragging pulls out curve handles (PSP's help, "About Drawing Mode and Edit Mode") |
| [ ] | Edit > Undo (Ctrl+Z) | Ported |
| [ ] | Edit > Redo (Ctrl+Alt+Z) | Ported |
| [ ] | Edit > Copy (Ctrl+C) | Ported: copies the contours holding the selected nodes |
| [ ] | Edit > Paste (Ctrl+V) | Ported: adds the copied contours to the object |
| [ ] | Edit > Delete (Del) | Ported |
| [ ] | Edit > Select All (Ctrl+A) | Ported |
| [ ] | Edit > Select None (Ctrl+D) | Ported |
| [ ] | Edit > Join Select (Ctrl+J) | Ported |
| [ ] | Edit > Merge (Ctrl+M) | Ported |
| [ ] | Edit > Break (Ctrl+K) | Ported |
| [ ] | Edit > Close (Shift+Ctrl+C) | Ported |
| [ ] | Edit > Reverse Contour (Ctrl+R) | Ported |
| [ ] | Edit > Reverse Path (Shift+Ctrl+R) | Ported |
| [ ] | Node Type > Asymmetric (Shift+Ctrl+S) | Ported |
| [ ] | Node Type > Symmetric (Ctrl+S) | Ported |
| [ ] | Node Type > Cusp (Ctrl+X) | Ported |
| [ ] | Node Type > Smooth/Tangent (Ctrl+T) | Ported |
| [ ] | Node Type > Convert To Line (Ctrl+L) | Ported |
| [ ] | Node Type > Line Before (Ctrl+B) | Ported |
| [ ] | Node Type > Line After (Ctrl+F) | Ported |
| [ ] | Node Type > Curve Before (Ctrl+1) | Ported: the new handle is a quarter of the distance to the neighbour (0x4f50a0) |
| [ ] | Node Type > Curve After (Ctrl+2) | Ported: as Curve Before |
| [ ] | Refresh (F5) | Ported |
| [ ] | Quit Node Editing (Ctrl+Q) | Ported |

## Add layer context menu

| | Item | Status |
|---|---|---|
| [ ] | New Raster Layer... | Ported |
| [ ] | New Vector Layer... | Ported |
| [ ] | New Adjustment Layer > Brightness/Contrast... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Channel Mixer... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Color Balance... | Ported: PSP's table builder, with and without Preserve Luminosity (section 13); the three tone groups show together instead of PSP's Tone balance buttons |
| [ ] | New Adjustment Layer > Curves... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Hue/Saturation... | Ported: master and the six hue ranges, Colorize starting at the foreground's hue, PSP's per-degree tables and pixel routine (section 13); the range bounds keep PSP's defaults |
| [ ] | New Adjustment Layer > Invert... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Levels... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Posterize... | Ported: the dialog changes the layer as you go; Cancel puts it back |
| [ ] | New Adjustment Layer > Threshold... | Ported: the dialog changes the layer as you go; Cancel puts it back |

## Vector object context menu

| | Item | Status |
|---|---|---|
| [ ] | Cut | Ported |
| [ ] | Copy | Ported |
| [ ] | Delete | Ported |
| [ ] | Properties... | Ported |
| [ ] | Select | Ported: toggles the object of the Layer palette row it was opened on (vector layers list their objects in the Layer palette, as in PSP) |
| [ ] | Select All | Ported |
| [ ] | Select None | Ported |

## Quick mask context menu

| | Item | Status |
|---|---|---|
| [ ] | Hide All (Shift+Y) | Ported |
| [ ] | Show All | Ported |
| [ ] | Hide Selection | Ported |
| [ ] | Show Selection | Ported |
| [ ] | From Image... | Ported |

## Text entry context menu

| | Item | Status |
|---|---|---|
| [ ] | Undo | Ported |
| [ ] | Cut | Ported |
| [ ] | Copy | Ported |
| [ ] | Paste | Ported: the text box's own |
| [ ] | Delete | Ported |
| [ ] | Select All | Ported: the text box's own |

## Palettes and windows

| | Item | Status |
|---|---|---|
| [ ] | Main toolbar | Ported: buttons from Psp.exe; the default set is the one PSP 6 sets in code (0x65a0d0) |
| [ ] | Tool palette | Ported |
| [ ] | Tool Options palette | Ported: each tool's options from its dialog template, remembered per tool; the Brush Tip and Picture Tube pictures |
| [ ] | Color palette | Ported: docked; foreground and background styles, the color picker area, recent colors |
| [ ] | Layer palette | Ported: visibility, lock transparency, groups, opacity, blend modes, mask toggles, rename, reorder, right-click menu |
| [ ] | Histogram window | Ported |
| [ ] | Brush tip palette | Ported: the Brush Tip tab of the Tool Options palette with its tip picture, as in PSP 6 |
| [ ] | Status bar | Changed: "Ready" instead of "For Help, press F1", then a command's prompt while hovered, cursor position, color under the cursor, image size and colors |
| [ ] | Image windows (MDI) | Ported: move, resize, minimize, maximize, close, cascade, tile |
| [ ] | Browser window | Changed: see File > Browse |

## Keys

| | Item | Status |
|---|---|---|
| [ ] | Accelerators from Psp.exe (table 129 with an image, then 128) | Ported: browsers keep Ctrl+N, Ctrl+T and Ctrl+W for themselves unless JSPaintShop runs as an installed app |
| [ ] | T, P, C, O, L, H toggle the bars and palettes | Ported |
| [ ] | Tab hides and shows all palettes | Ported |
| [ ] | Alt+letter opens a menu, arrows walk it | Ported |
| [ ] | Toolbar menu on right-click (MENU 436) | Ported |

## File formats

| | Format | Open | Save | Status |
|---|---|---|---|---|
| [ ] | PSP (.psp, .tub, .pfr), file versions 3 (PSP 5) and 4 (PSP 6) | Yes | Yes | Changed: raster layers with position, opacity, visibility, blend modes, masks and Creator Information; the picture tube block; the selection and alpha channels (read and saved); PSP 6's own vector layers (paths and text) and adjustment layers are read (section 19), JSPaintShop's own vector and adjustment layers are saved as raster layers plus an extension block |
| [ ] | Windows or OS/2 Bitmap (.bmp, .dib, .rle) | Yes | Yes | Ported: 1/4/8/16/24/32 bits, RLE4/RLE8, bit fields; saves 24 bits, or the palette's depth for a paletted image |
| [ ] | GIF (.gif) | Yes | Yes | Changed: the first image of an animation; a transparent GIF opens with its palette transparency set (Colors > Set Palette Transparency); a paletted image saves on its own palette, full color is reduced to 256 colors by median cut |
| [ ] | JPEG (.jpg, .jpeg, .jif, .jpe) | Yes | Yes | Changed: the browser's codec; the quality is the JPEG Wizard's last setting (85 at first); the resolution is kept |
| [ ] | PNG (.png) | Yes | Yes | Changed: the browser's codec, always saved as 32-bit RGBA (a paletted image's transparent entry saved clear); the resolution is kept |
| [ ] | Truevision Targa (.tga) | Yes | Yes | Ported |
| [ ] | Zsoft Paintbrush (.pcx), Multipage (.dcx) | Yes | PCX only | Ported |
| [ ] | Portable Bitmap / Greymap / Pixelmap (.pbm, .pgm, .ppm) | Yes | Yes | Ported |
| [ ] | Sun Raster (.ras) | Yes | Yes | Ported: saves 2, 256 (with its color map) or 16 million colors as PSP's EncodeRAS (section 21) |
| [ ] | Tagged Image File Format (.tif, .tiff) | Yes | Yes | Changed: opens strips or tiles, none/LZW/PackBits/Deflate, bilevel to 16-bit RGB and CMYK, palette, alpha; saves 8-bit RGB(A) with LZW (PSP 6 offers more compressions and CMYK) |
| [ ] | Photoshop (.psd) | Yes | Yes | Changed: layers with position, opacity, blend mode, visibility, lock transparency and mask; Bitmap, Greyscale, Indexed, RGB and CMYK at 8 or 16 bits; saves 8-bit RGB with layers. Added: ZIP-compressed layer channels (with or without prediction) open |
| [ ] | Amiga IFF / Deluxe Paint LBM (.iff, .lbm) | Yes | Yes | Ported: ILBM 1-8 planes and 24-bit, PBM, HAM6 and Extra Half-Brite as PSP reads them; saves ILBM with ByteRun1 (section 21) |
| [ ] | MacPaint (.mac) | Yes | Yes | Ported: saves 576 x 720 2-color images, as PSP (no MacBinary header) |
| [ ] | Microsoft Paint (.msp) | Yes | Yes | Ported: versions 1 and 2; saves version 2, 2 colors |
| [ ] | GEM Paint (.img) | Yes | Yes | Changed: 1 to 8 planes (several open in greys, as PSP); saves 2, 16 or 256 colors with the first plane the lowest bit (PSP 6 writes the highest first, which its own reader then misreads) |
| [ ] | Dr. Halo (.cut) | Yes | Yes | Changed: opens in color when the .pal is chosen with the .cut, else in greys; saves 256-color images and then the .pal as a second file (PSP 6 writes it beside the .cut by itself) |
| [ ] | Windows Clipboard (.clp) | Yes | Yes | Ported: its bitmap; saves PSP's 14-byte header with one device-independent bitmap |
| [ ] | Windows Icon / Cursor (.ico, .cur) | Yes | No | Added: the largest image, with its mask |
| [ ] | Macintosh PICT (.pct, .pict) | Yes | Yes | Changed: BitsRect, PackBitsRect and DirectBitsRect pictures, and QuickTime raw, JPEG, PNG or TIFF inside; drawing operations are skipped; saves version 1 (2 colors) or version 2 with PSP's records (PackBitsRect with a color table, DirectBitsRect packed per component) |
| [ ] | WordPerfect Bitmap (.wpg) | Yes | Yes | Changed: WPG 1 and WPG 2 bitmaps with their color maps (vector records are skipped); saves WPG 1 at 2, 16 or 256 colors with the color map's true length (PSP 6 writes 0x0104 for 256 colors) |
| [ ] | Scitex Continuous Tone (.sct, .ct) | Yes | Yes | Changed: PSP's reader (section 18); saved as CMYK in inches, with the inks divided by 1 - K, which PSP 6 leaves out |
| [ ] | Raw File Format (.raw) | Yes | Yes | Changed: the RAW Options and RAW dialogs (8015, 468) with PSP's layouts; the CMY and CMYK buttons read what they say (PSP 6 swaps them) and CMYK blue is clamped. Added: sizes that fit the file (OpenPhotex and JSPod rules), .ACT / .PAL palettes for a single channel (chosen with the RAW, beside it in Browse, or loaded in the dialog), and unchanged palette indices saved back as they were |
| [ ] | PC Paint / Pictor (.pic) | Yes | Yes | Ported: 1, 4 and 8-bit, EGA and VGA palettes, run-length blocks; saves 256 colors or fewer as PSP does |

## Additions

| | Item | Status |
|---|---|---|
| [ ] | Ctrl+wheel zooms at the pointer | Added |
| [ ] | Files dropped on the work area open | Added: PSP opens files dropped from Explorer the same way |
| [ ] | Leaving the page with unsaved images asks first | Added |

## Deliberate changes

- The look is JSTraxx's flat light and dark theme, with PSP 6's own button art.
- Toolbars sit on the frame with no button face; the dark theme uses a recolored copy of PSP 6's button art (light outlines, lightened dark colors).
- The program is called JSPaintShop everywhere in the UI, including the help and tips imported from PSP 6, and has its own icon (`public/jspaintshop.svg`).
- Settings live in the browser's private storage (OPFS) instead of the registry.
- Image window titles end with "*" while the image has unsaved changes.

## Not ported

- Capture, TWAIN and digital camera import: browsers cannot reach other programs' windows, scanners or camera drivers; removed from the menus.
- Help Topics, How Do I, context help (F1, Shift+F1) and Tip of the Day: removed with PSP's WinHelp.
- Animation Shop, Image Robot, StudioAvenue and the vendor's web links: separate programs or closed services, removed from the menus.
- Digimarc watermarks: proprietary.
- File associations, color management profiles and monitor gamma: the browser and the system own these.
- Vector and proprietary file formats: WMF, EMF, EPS, AI, CGM, CDR, CMX, DRW, DXF, HPGL, Kodak Photo CD, FlashPix and Kodak DC cameras need their vendors' libraries.
- Photoshop plug-ins (Export plug-ins, filter plug-ins): Windows code that cannot run in a browser; removed from the menus.
