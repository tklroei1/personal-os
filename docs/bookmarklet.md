# Facebook / Web Bookmarklet — Send to Personal OS

## Purpose
When browsing Facebook groups or any job/apartment listing, click this bookmark to instantly send the URL to your Personal OS inbox.

## Installation
1. Create a new bookmark in your browser
2. Set the name to "📌 שלח לPOS"
3. Paste the following as the URL:

```javascript
javascript:(function(){var t=document.title,u=location.href;window.open('https://personal-os-coral-tau.vercel.app/?title='+encodeURIComponent(t)+'&url='+encodeURIComponent(u));})();
```

## Usage
1. Navigate to any Facebook listing, LinkedIn job, or Yad2 apartment
2. Click the "📌 שלח לPOS" bookmark
3. The app opens and the item appears in the Inbox (📥 תיבת כניסה)
4. From the Inbox, route the item to: Job Search Pipeline, Apartment List, or Notes

## Notes
- The bookmarklet opens a new tab with the share URL — the main app receives the item
- Works on desktop browsers (Chrome, Firefox, Safari, Edge)
- On mobile: use the PWA Share Target instead (tap Share → Personal OS)
