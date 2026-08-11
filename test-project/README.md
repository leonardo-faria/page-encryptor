# 🌿 Digital Garden

A minimalist portfolio website featuring a beautiful gallery of creative work.

## Features

- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Interactive Gallery**: Click on any project card to view details in a modal
- **Smooth Animations**: CSS animations and transitions for a polished feel
- **Navigation**: Sticky navigation bar with smooth scrolling
- **Dark Mode Toggle**: Switch between light and dark themes
- **Counter Animations**: Animated statistics that count up on page load

## Project Structure

```
page-encryptor/
├── index.html          # Main HTML file with all CSS and JS
├── images/             # Local image files (sourced from Unsplash)
│   ├── mountain.jpg
│   ├── architecture.jpg
│   ├── forest.jpg
│   ├── ocean.jpg
│   ├── sunset.jpg
│   └── desert.jpg
├── README.md           # This file
└── .gitignore         # Git ignore rules
```

## Technologies Used

- **HTML5**: Semantic markup structure
- **CSS3**: Modern styling with CSS Grid and Flexbox
- **Vanilla JavaScript**: No frameworks, pure JS for interactivity
- **Responsive Images**: Local image files for fast loading

## Getting Started

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd page-encryptor
   ```

2. Open `index.html` in your web browser or serve it with a local server:
   ```bash
   # Using Python 3
   python -m http.server 8000
   
   # Using Node.js (if http-server is installed)
   http-server
   ```

3. Navigate to `http://localhost:8000` in your browser

## Features Explained

### Gallery
- 6 sample projects displayed in a responsive grid
- Hover effects that lift cards above the page
- Click to open detailed modal view

### Navigation
- Smooth scroll navigation to different sections
- Dark mode toggle (CSS-based switching)
- Sticky positioning for easy access

### Animations
- Fade-in animations on page load
- Smooth transitions on hover
- Counter animations for statistics

## Customization

To add more projects to the gallery:

1. Open `index.html`
2. Locate the `galleryData` array in the JavaScript section
3. Add a new object with the following structure:
   ```javascript
   {
       id: 7,
       title: 'Your Project Title',
       image: 'images/your-image.jpg',
       description: 'Your project description',
       tags: ['Tag1', 'Tag2', 'Tag3']
   }
   ```
4. Add your image to the `images/` folder

## Color Scheme

- Primary: `#2d5016` (Forest Green)
- Secondary: `#7fb069` (Light Green)
- Accent: `#f4e8d0` (Cream)
- Dark: `#1a1a1a` (Almost Black)
- Light: `#f9f9f9` (Off White)

## License

Open source - feel free to use and modify!

---

Created with ❤️ as a minimalist portfolio template
