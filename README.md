# Spotify Downloader

A web application that allows you to download songs and playlists from Spotify. Built with React, Node.js, and Express.

## Features

- Download individual tracks from Spotify
- Download entire playlists while maintaining order
- Parallel processing for faster playlist downloads
- Real-time progress tracking
- Clean and modern Material UI interface
- Abort functionality for downloads

## Prerequisites

Before you begin, ensure you have installed:

- Node.js (v14 or higher)
- npm (comes with Node.js)
- yt-dlp
- ffmpeg

## Installation

1. Clone the repository:

```bash
git clone <your-repo-url>
cd spotify-downloader
```

2. Install backend dependencies:

```bash
npm install
```

3. Install frontend dependencies:

```bash
cd client
npm install
```

4. Create a `.env` file in the root directory with your Spotify API credentials:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
PORT=3000
```

You can get these credentials by creating an application in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

## Usage

1. Start the backend server:

```bash
npm run dev
```

2. In a separate terminal, start the frontend:

```bash
cd client
npm start
```

3. Open your browser and navigate to `http://localhost:3001`

## Development

The project structure is as follows:

- `/` - Backend Express server
- `/client` - React frontend
- `/downloads` - Temporary directory for downloads (automatically created)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This tool is for educational purposes only. Please respect copyright laws and Spotify's terms of service.
# downloader-final
