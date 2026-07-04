import * as React from 'react';

export interface RoleContextValue {
  canMutate: boolean;
  isAdmin: boolean;
  isManager: boolean;
}

export const RoleContext = React.createContext<RoleContextValue>({
  canMutate: true,
  isAdmin: false,
  isManager: false,
});

export const usePageRole = () => React.useContext(RoleContext);
