import React, { useState } from "react";
import { Box, Typography } from "@mui/material";

const AdBanner = ({ position, adContent }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  // Handle image load success
  const handleImageLoad = () => {
    setIsLoaded(true);
  };

  return (
    <Box
      className={`ad-banner banner-${position}${isLoaded ? " loaded" : ""}`}
      sx={{
        position: "fixed",
        top: 0,
        [position]: 0,
        width: "160px",
        height: "650px", // Increased height to accommodate text
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        backgroundColor: "transparent",
        zIndex: 1000,
      }}
    >
      <img
        src={adContent.image}
        alt={adContent.alt}
        style={{
          width: "100%",
          height: "600px",
          objectFit: "cover",
          opacity: isLoaded ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
        onLoad={handleImageLoad}
        loading="lazy"
      />
      <Typography
        variant="caption"
        sx={{
          mt: 1,
          color: "#666",
          textAlign: "center",
          fontSize: "0.75rem",
          padding: "4px",
          backgroundColor: "rgba(255, 255, 255, 0.9)",
          borderRadius: "4px",
          width: "100%",
        }}
      >
        Contact kanesyutup@gmail.com to Display your ads
      </Typography>
    </Box>
  );
};

export default AdBanner;
