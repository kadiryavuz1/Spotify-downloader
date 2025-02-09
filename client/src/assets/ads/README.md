# Advertisement Assets

This directory contains advertisement images and GIFs that are displayed in the side banners of the application.

## Guidelines for Ad Content:

1. **Dimensions:**

   - Width: 160px
   - Height: 600px (vertical banner)
   - Format: JPG, PNG, or GIF

2. **File Naming:**

   - Use descriptive names (e.g., `ad1.gif`, `sponsor-name.png`)
   - Keep filenames lowercase and use hyphens for spaces

3. **Performance:**

   - Optimize images for web use
   - Keep GIF file sizes under 1MB
   - Use compressed formats when possible

4. **Content:**
   - Ensure content is appropriate and family-friendly
   - Avoid flashy or distracting animations
   - Include clear call-to-action if applicable

## How to Add New Ads:

1. Add your ad image/GIF to this directory
2. Update the `src/config/ads.js` file with the new ad information:

```javascript
import myAd from "../assets/ads/ad1.png";

export const adsConfig = {
  left: {
    image: myAd,
    alt: "Your Ad Description",
    link: "https://your-ad-link.com",
  },
  // ...
};
```

## Current Ad Slots:

- Left sidebar banner
- Right sidebar banner
