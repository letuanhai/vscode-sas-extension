// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import localize from "./localize";

interface TabBarProps {
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TabBar = ({ tabs, activeTab, onTabChange }: TabBarProps) => {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={activeTab === tab ? "active" : ""}
          onClick={() => onTabChange(tab)}
          type="button"
        >
          {localize(tab)}
        </button>
      ))}
    </div>
  );
};

export default TabBar;
