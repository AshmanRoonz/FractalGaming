--!strict
-- Skybox face asset ids, read by the client SkyController. The sky is installed
-- per-client (so it can be turned off on Low-quality / touch devices). Paste the six
-- rbxassetid strings here. Leave `enabled = false` (or blank ids) to use the default sky.

return {
	enabled = true,
	Up = "rbxassetid://132381318019359", -- top_1.png (greyscale)
	Dn = "rbxassetid://85569326507257", -- bottom_1.png
	Lf = "rbxassetid://104002422471987", -- wall4_2.png
	Rt = "rbxassetid://104002422471987", -- wall4_2.png (reused; no wall2)
	Ft = "rbxassetid://140301767713852", -- wall1_2.png
	Bk = "rbxassetid://98401617886686", -- wall3_2.png
}
