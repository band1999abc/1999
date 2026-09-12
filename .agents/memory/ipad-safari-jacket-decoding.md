---
name: iPad Safari jacket decoding
description: Browser-loading constraint for jacket photos selected on iPad Safari
---

Load selected jacket images through `FileReader.readAsDataURL()` before assigning them to an `Image` element for Canvas processing. Do not replace this with a Blob URL without repeating the iPad Safari test.

**Why:** On iPad Safari, the same valid JPEG was readable by FileReader and decoded successfully from its Data URL, while `URL.createObjectURL(file)` succeeded but assigning that Blob URL to an Image produced `onerror` with zero natural dimensions.

**How to apply:** Keep the Data URL local to the browser, never log or send the original value, and only send the separately resized and compressed result through the existing jacket API.