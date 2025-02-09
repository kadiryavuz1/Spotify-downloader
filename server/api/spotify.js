const SpotifyWebApi = require("spotify-web-api-node");
require("dotenv").config();

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

async function refreshSpotifyToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body["access_token"]);
    console.log("Spotify token refreshed");
  } catch (err) {
    console.error("Error refreshing token:", err);
    throw err;
  }
}

// Extract Spotify ID from URL
function extractSpotifyId(url) {
  try {
    const urlWithoutParams = url.split("?")[0];
    if (urlWithoutParams.includes("track/")) {
      return { type: "track", id: urlWithoutParams.split("track/")[1] };
    } else if (urlWithoutParams.includes("playlist/")) {
      return { type: "playlist", id: urlWithoutParams.split("playlist/")[1] };
    } else if (urlWithoutParams.includes("album/")) {
      return { type: "album", id: urlWithoutParams.split("album/")[1] };
    }
  } catch (err) {
    console.error("Error extracting Spotify ID:", err);
  }
  return { type: null, id: null };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await refreshSpotifyToken();
    const { url } = req.body;
    const { type, id } = extractSpotifyId(url);

    if (!id) {
      return res.status(400).json({ error: "Invalid Spotify URL" });
    }

    let result;
    switch (type) {
      case "track":
        const track = await spotifyApi.getTrack(id);
        result = {
          type: "track",
          info: {
            name: track.body.name,
            artist: track.body.artists[0].name,
            album: track.body.album.name,
            image: track.body.album.images[0]?.url,
          },
        };
        break;

      case "playlist":
        const playlist = await spotifyApi.getPlaylist(id);
        if (playlist.body.owner.id === "spotify") {
          throw new Error(
            "Only playlists created by users are supported. Official Spotify playlists or radios will not work."
          );
        }
        const tracks = await getAllPlaylistTracks(id);
        result = {
          type: "playlist",
          name: playlist.body.name,
          tracks: tracks,
        };
        break;

      default:
        return res.status(400).json({ error: "Invalid content type" });
    }

    res.json(result);
  } catch (err) {
    console.error("Error processing request:", err);
    res.status(500).json({ error: err.message });
  }
};
