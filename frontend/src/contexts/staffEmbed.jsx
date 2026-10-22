import React, { createContext, useContext } from 'react';

const StaffEmbedContext = createContext({ embedded: false });

export const useStaffEmbed = () => useContext(StaffEmbedContext);

export const StaffEmbedProvider = ({ children, value }) => (
  <StaffEmbedContext.Provider value={value}>{children}</StaffEmbedContext.Provider>
);
