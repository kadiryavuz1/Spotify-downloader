import React, { useState } from "react";
import { Box } from "@mui/material";

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
        height: "600px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
        zIndex: 1000,
      }}
    >
      <img
        src={adContent.image}
        alt={adContent.alt}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: isLoaded ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
        onLoad={handleImageLoad}
        loading="lazy"
      />
    </Box>
  );
};

export default AdBanner;
