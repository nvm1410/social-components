import React, { useState, useEffect, useRef, useContext } from "react";
import { GlobalContext } from "../../contexts/GlobalContext";
import { Orbis } from "@orbisclub/orbis-sdk";
import { defaultTheme, getThemeValue } from "../../utils/themes";
import { checkCredentialOwnership } from "../../utils";
import ConnectModal from "../ConnectModal";

/** For Magic */
import Web3 from 'web3';
import { Magic } from 'magic-sdk';
import { ConnectExtension } from '@magic-ext/connect';

/** Initialize Magic */
let magic;
let web3;
if (typeof window !== "undefined") {
  magic = new Magic('pk_live_2E6B3B065093108E', {
    network: 'mainnet',
    extensions: [new ConnectExtension()]
  });
  web3 = new Web3(magic.rpcProvider);
};

let _orbis = new Orbis({
  node: "https://node2.orbis.club/"
});

export default function OrbisProvider({ context, children, theme = defaultTheme, options }) {
  const [orbis, setOrbis] = useState(_orbis);
  const [user, setUser] = useState();
  const [connecting, setConnecting] = useState();
  const [credentials, setCredentials] = useState([]);
  const [hasAccess, setHasAccess] = useState(true);
  const [activeTheme, setActiveTheme] = useState(theme);
  const [contextDetails, setContextDetails] = useState();
  const [accessRules, setAccessRules] = useState([]);
  const [connectModalVis, setConnectModalVis] = useState(false);

  useEffect(() => {
    if(!user) {
      checkOrbisConnected();
    }
    async function checkOrbisConnected() {
      if(localStorage.getItem("ceramic-session")) {
        setConnecting(true);
      }
      let res = await orbis.isConnected();

      if(res && res.status == 200) {
        setUser(res.details);
        loadCredentials(res.details.did);
      }

      setConnecting(false);
    }
  }, [user, orbis]);

  /** Load credentials for the connected user */
  async function loadCredentials(did) {
    let { data, error, status } = await orbis.api.rpc("get_verifiable_credentials", {
	    q_subject: did,
	    q_min_weight: 10
	  });

    if(data && data.length > 0) {
      setCredentials(data);
    } else {
      setCredentials([]);
    }
  }

  /** Load style details if available */
  useEffect(() => {
    if(theme) {
      /** theme object passed is alredy in the JSON format, use it directly */
      if(typeof theme === 'object') {
        setActiveTheme(theme);
      } else {
        loadStyle();
      }
    }

    async function loadStyle() {
      /** Step 1: Check if theme content is stored in localStorage */
      let storedStyle = localStorage.getItem(theme);
      if(storedStyle) {
        setActiveTheme(JSON.parse(storedStyle));
      }

      /** Step 2: Download the latest version of the theme */
      try {
        let { data: styleStream, error } = await orbis.api.from("orbis_styles").select().eq('stream_id', theme).single();
        setActiveTheme(styleStream.content?.theme);
        localStorage.setItem(theme, JSON.stringify(styleStream.content?.theme));
      } catch(e) {
        console.log("Can't log Ceramic stream:", e);
      }
    }
  }, [theme, orbis])


  /** Load context details if available */
  useEffect(() => {
    if(context) {
      loadContextDetails();
    }

    /** Load context details from Ceramic */
    async function loadContextDetails() {
      let _context = cleanContext(context);

      /** Step 1: Check if theme content is stored in localStorage */
      let storedContext = localStorage.getItem(_context);
      if(storedContext) {
        storedContext = JSON.parse(storedContext);
        setContextDetails(storedContext);

        /** Save access rules */
        if(storedContext.accessRules && storedContext.accessRules.length > 0) {
          setAccessRules(storedContext.accessRules);
        }
      }

      /** Step 2: Load context details from Ceramic */
      try {
        let { data: _contextDetails, error } = await orbis.api.from("orbis_contexts").select().eq('stream_id', _context).single();
        if(_contextDetails) {
          setContextDetails(_contextDetails.content);

          /** Save access rules */
          if(_contextDetails.content?.accessRules && _contextDetails.content.accessRules.length > 0) {
            setAccessRules(_contextDetails.content.accessRules);
          }

          /** Save in localStorage */
          localStorage.setItem(_context, JSON.stringify(_contextDetails.content));
        }
      } catch(e) {
        console.log("Can't load context details:", e);
      }
    }
  }, [context]);

  useEffect(() => {
    let countUserCredentials = credentials ? credentials.length : 0;
    let countAccessRules = accessRules ? accessRules.length : 0;
    let _hasAccess = false;

    /** Option 1: There isn't any access rules: User has access */
    if(countAccessRules == 0) {
      _hasAccess = true;
    }

    /** Option 2: User doesn't have any credentials but there are some access rules */
    else if(countAccessRules > 0 && countUserCredentials == 0) {
      _hasAccess = false;
    }

    /** Option 3: User has credentials and there are some access rules: Check if user has access */
    else if(countUserCredentials > 0 && countAccessRules > 0) {
      _hasAccess = checkContextAccess(credentials, accessRules);
    }

    /** Save result in state */
    setHasAccess(_hasAccess);
  }, [credentials, accessRules]);

  /** Will loop through rules and user credentials to check if the user has access to this context */
  function checkContextAccess(_userCredentials, _accessRules) {
    let _hasAccess = false;

    /** Loop through all rules assigned to this context */
    _accessRules.forEach((_rule, i) => {
      /** Handle operators function */
      if(_rule.operator) {
        //console.log("_rule.operator:", _rule.operator);
      }

      /** Manage verifications based on rules type */
      switch (_rule.type) {
        case "credential":
          /** Loop through all credentials required in this rule */
          _rule.requiredCredentials.forEach((cred, i) => {
            let _hasVc = checkCredentialOwnership(_userCredentials, cred.identifier);
            if(_hasVc) {
              _hasAccess = true;
            }
          });

          break;
        case "did":
          /** Loop through all credentials required in this rule */
          _rule.authorizedUsers.forEach((_user, i) => {
            if(_user.did == user.did) {
              _hasAccess = true;
            }
          });
          break;
        default:

      }
    });

    return _hasAccess;
  }

  return(
    <GlobalContext.Provider value={{ user, setUser, connecting, setConnecting, orbis, magic, context, theme: activeTheme, accessRules: accessRules, hasAccess, credentials, setCredentials, connectModalVis, setConnectModalVis }}>
      {children}

      {/** Show Connect Modal */}
      {connectModalVis &&
        <ConnectModal lit={false} hide={() => setConnectModalVis(false)} />
      }
    </GlobalContext.Provider>
  )
}


/** Clean context string by checking if it it's composed of a sub-context to keep only the parent context for access rules */
function cleanContext(context) {
  if(context.includes(":")) {
    let _arr = context.split(":");
    return _arr[0];
  } else {
    return context;
  }

}
