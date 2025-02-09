import React from "react";
import {
  Box,
  CircularProgress,
  Typography,
  LinearProgress,
} from "@mui/material";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import AudiotrackIcon from "@mui/icons-material/Audiotrack";

const DownloadProgress = ({
  status,
  progress,
  currentTrack,
  totalTracks,
  trackName,
}) => {
  console.log("DownloadProgress props:", {
    status,
    progress,
    currentTrack,
    totalTracks,
    trackName,
  });

  const getStatusIcon = () => {
    switch (status) {
      case "downloading":
        return <CloudDownloadIcon color="primary" />;
      case "extracting":
        return <AudiotrackIcon color="secondary" />;
      case "completed":
      case "complete":
        return <AudiotrackIcon color="success" />;
      default:
        return null;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "downloading":
        return "Downloading...";
      case "extracting":
        return "Processing audio...";
      case "completed":
      case "complete":
        return "Complete";
      case "creating_zip":
        return "Creating zip file...";
      case "error":
        return "Error";
      default:
        return status || "";
    }
  };

  return (
    <Box sx={{ width: "100%", mb: 2, mt: 2 }}>
      {/* Overall Progress */}
      {typeof progress === "number" && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Overall Progress: {progress}%
            {currentTrack &&
              totalTracks &&
              ` (${currentTrack}/${totalTracks} tracks)`}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{ height: 8, borderRadius: 2 }}
          />
        </Box>
      )}

      {/* Current Track Progress */}
      {(status || trackName) && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 2 }}>
          {getStatusIcon()}
          <Box sx={{ flexGrow: 1 }}>
            {trackName && (
              <Typography variant="body2" noWrap>
                {trackName}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {getStatusText()}
            </Typography>
          </Box>
          {(status === "downloading" || status === "extracting") && (
            <CircularProgress size={24} />
          )}
        </Box>
      )}
    </Box>
  );
};

export default DownloadProgress;
