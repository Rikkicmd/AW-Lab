# AW+ Test Lab

A browser-based training lab for AlliedWare Plus style switch configuration. Open `index.html` in any modern browser: no install, no server, no switch images needed.

Created by Rikki Keene. © 2026 Rikki Keene.

> Independent training simulator. Not affiliated with or endorsed by Allied Telesis. AlliedWare Plus is a trademark of Allied Telesis, Inc. This project contains no Allied Telesis software.

## Topology

```
                 CORE (SW1, x530-28GTXm)
       port1.0.1 + port1.0.3       port1.0.2
                 ||                    |
       port1.0.10 + port1.0.9      port1.0.10
       ACCESS1 (SW2, x230-10GP) -- ACCESS2 (SW3, x230-10GP)
                       port1.0.8 <-> port1.0.8
       port1.0.1   port1.0.2      port1.0.1   port1.0.2
          |           |              |           |
         PC1        CAM1            PC2        NVR1
  192.168.10.11  192.168.20.21  192.168.10.12  192.168.20.22
```

Switch login: `manager` / `friend`

## What it simulates

- AW+ style CLI with modes (`>`, `#`, `(config)#`, `(config-if)#`, `(config-vlan)#`), abbreviated commands, `?` help, Tab completion, history, `do`, and `^` error markers
- VLAN database, access ports, trunks (allowed / native VLANs), port and VLAN interface shutdown and descriptions
- VLAN interfaces with IP addressing, inter-VLAN routing, static routes
- `show running-config`, `startup-config`, `vlan brief`, `interface brief|switchport|IF`, `ip interface brief`, `ip route`, `lldp neighbors`, `mac address-table`, `version`, `system`, `clock`
- `write`, `copy running-config startup-config`, `erase startup-config`, `reload`
- Rapid spanning tree (single instance): root election, bridge and port priority, path cost, root / designated / alternate roles, edge ports, `show spanning-tree [brief]`
- Link aggregation: LACP (`channel-group N mode active|passive`, `poN`) and static (`static-channel-group N`, `saN`), `show etherchannel [summary]`, `show static-channel-group`
- Loop detection: if spanning tree is disabled or misconfigured, redundant links cause a broadcast storm and traffic in the affected VLANs fails
- `ping` and `traceroute` computed from the real L2/L3 state of the lab
- End devices with a simple host shell (`ip`, `show`, `ping`, `trace`)

## Coursework

- **Exercises:** 11 guided tasks that build a Data (VLAN 10), CCTV (VLAN 20) and Management (VLAN 99) design, then make CORE the root bridge, bundle the ACCESS1 uplinks with LACP and set edge ports. Each is checked live.
- **Fault tickets:** pre-broken labs to troubleshoot (CCTV outage, PC offline, unmanageable switch, site-wide broadcast storm, LACP bundle down), plus a completed reference lab.
- **Live connectivity:** six reachability checks update after every command.

Progress is kept in the browser's local storage. Use **Export lab** / **Import lab** to move a lab between machines.

## Not yet simulated

MSTP, per-VLAN spanning tree, ACLs, OSPF, DHCP, AMF, timers (spanning tree converges instantly).

## Tests

```
npm install playwright
node tests/engine-test.js
```

The test loads every scenario and confirms the expected pass/fail pattern for the connectivity checks and exercises, then exercises the CLI parser and takes a screenshot.
