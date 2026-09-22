using System;
using System.IO;
using FindDifference;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace FindDifference.Editor
{
    public static class ProjectBuilder
    {
        const string Root = "Assets/FindDifference";
        static readonly Color Ink = new Color32(63, 75, 98, 255);
        static readonly Color Muted = new Color32(110, 122, 145, 255);
        static readonly Color Pale = new Color32(250, 249, 246, 255);
        static readonly Color Gold = new Color32(222, 195, 123, 255);
        static Font font;

        [MenuItem("Find Difference/Rebuild editable scene")]
        public static void Build()
        {
            PrepareSprites();
            font = Resources.GetBuiltinResource<Font>("Arial.ttf");
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camera = new GameObject("Main Camera", typeof(Camera), typeof(AudioListener));
            camera.tag = "MainCamera";
            camera.transform.position = new Vector3(0, 0, -10);
            camera.GetComponent<Camera>().orthographic = true;
            camera.GetComponent<Camera>().backgroundColor = new Color(.85f, .90f, .96f);
            camera.GetComponent<Camera>().clearFlags = CameraClearFlags.SolidColor;

            var canvasObject = new GameObject("Canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            var canvas = canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasObject.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(750, 1334);
            scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
            scaler.matchWidthOrHeight = .5f;
            new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
            var controller = new GameObject("GameFlow").AddComponent<FindDifferenceGame>();
            var root = canvasObject.GetComponent<RectTransform>();

            var home = Page(root, "HomePage", "bg_home");
            controller.homePage = home.gameObject;
            TextLabel(home, "Title", "寻迹王国", 0, 466, 620, 122, 78, Ink, FontStyle.Bold);
            TextLabel(home, "Subtitle", "轻松找不同 · 五关挑战", 0, 380, 600, 50, 27, Muted);
            controller.homePlay = Button(home, "BtnStart", "开始挑战", "button_primary_home", 0, -340, 380, 100, 38);
            controller.homeContinue = TextLabel(home, "ContinueLevel", "第1关", 0, -414, 210, 48, 24, Ink);
            controller.homeRank = Button(home, "BtnRanking", "排行榜", "button_secondary_normal", -230, -350, 155, 84, 24);
            controller.homeLevels = Button(home, "BtnLevelSelect", "选关", "button_secondary_normal", 230, -350, 155, 84, 24);

            var levels = Page(root, "LevelSelectPage", "bg_content");
            controller.levelPage = levels.gameObject;
            controller.levelsBack = Button(levels, "BtnBack", "〈", "button_square_normal", -320, 575, 72, 72, 32);
            TextLabel(levels, "Title", "选择关卡", 0, 568, 500, 70, 43, Ink, FontStyle.Bold);
            controller.levelButtons = new Button[5];
            controller.levelThumbnails = new Image[5];
            controller.levelCaptions = new Text[5];
            for (var i = 0; i < 5; i++)
            {
                float x = i % 2 == 0 ? -165 : 165;
                float y = 325 - i / 2 * 290;
                var card = Button(levels, $"LevelCard{i + 1}", "", "level_card", x, y, 310, 260, 24);
                controller.levelButtons[i] = card;
                controller.levelThumbnails[i] = Picture(card.transform, "Thumbnail", $"Levels/level-{i + 1:00}/scene-a", 0, 30, 286, 170);
                controller.levelCaptions[i] = TextLabel(card.transform, "Caption", "第" + (i + 1) + "关", 0, -87, 290, 76, 23, Ink, FontStyle.Normal);
            }

            var game = Page(root, "GamePage", "bg_game");
            controller.gamePage = game.gameObject;
            controller.gameBack = Button(game, "BtnBack", "〈", "button_square_normal", -320, 604, 68, 68, 30);
            controller.levelTitle = TextLabel(game, "LevelTitle", "第1关", -44, 603, 155, 63, 36, Ink, FontStyle.Bold);
            controller.livesText = TextLabel(game, "Lives", "♥♥♥", 95, 603, 132, 53, 31, new Color32(207, 80, 94, 255));
            controller.timerText = TextLabel(game, "Timer", "2:00", 278, 603, 132, 62, 30, Ink);
            controller.progressText = TextLabel(game, "Progress", "0/8", 0, 551, 300, 47, 25, Muted);
            controller.levelName = TextLabel(game, "LevelName", "皇家城堡庭院", -215, 508, 380, 42, 25, Ink);
            MakeImageArea(game, "TopImageFrame", 260, out controller.topImage, out controller.topMarkers, controller);
            MakeImageArea(game, "BottomImageFrame", -250, out controller.bottomImage, out controller.bottomMarkers, controller);
            controller.gameHint = Button(game, "BtnHint", "提示", "button_secondary_normal", -230, -601, 175, 76, 28);
            controller.gameTime = Button(game, "BtnAddTime", "加时 +30秒", "button_primary_normal", 0, -601, 225, 76, 27);
            controller.gameShare = Button(game, "BtnShare", "分享", "button_secondary_normal", 233, -601, 126, 76, 26);
            controller.gameZoom = Button(game, "BtnZoom", "×2 放大", "button_secondary_white", 256, -516, 140, 48, 21);

            var rank = Page(root, "RankingPage", "bg_content");
            controller.rankPage = rank.gameObject;
            controller.rankBack = Button(rank, "BtnBack", "〈", "button_square_normal", -320, 575, 72, 72, 32);
            TextLabel(rank, "Title", "排行榜", 0, 555, 500, 75, 45, Ink, FontStyle.Bold);
            Panel(rank, "RankCard", "panel_light", 0, 0, 650, 970, Color.white);
            controller.rankBody = TextLabel(rank, "RankBody", "本机进度", 0, 0, 570, 870, 30, Ink);

            var result = Overlay(root, "ResultModal");
            controller.resultModal = result.gameObject;
            Panel(result, "ResultCard", "panel_selected", 0, 0, 600, 645, Color.white);
            controller.resultTitle = TextLabel(result, "ResultTitle", "挑战失败", 0, 230, 500, 75, 52, new Color32(207, 80, 94, 255), FontStyle.Bold);
            controller.resultSummary = TextLabel(result, "ResultSummary", "时间或生命已经耗尽", 0, 110, 520, 80, 28, Muted);
            controller.resultRevive = Button(result, "BtnRevive", "看广告复活", "button_primary_normal", 0, -5, 390, 74, 29);
            controller.resultRetry = Button(result, "BtnRetry", "再玩一次", "button_primary_normal", 0, -120, 390, 74, 29);
            controller.resultHome = Button(result, "BtnHome", "返回选关", "button_secondary_normal", -130, -228, 215, 70, 24);
            controller.resultShare = Button(result, "BtnShare", "分享成绩", "button_secondary_normal", 130, -228, 215, 70, 24);

            var ad = Overlay(root, "AdModal");
            controller.adModal = ad.gameObject;
            Panel(ad, "AdCard", "panel_light", 0, 0, 600, 620, Color.white);
            TextLabel(ad, "AdTitle", "广告演示", 0, 235, 490, 75, 48, Ink, FontStyle.Bold);
            TextLabel(ad, "AdNote", "H5 开发环境模拟激励视频", 0, 165, 520, 45, 24, Muted);
            controller.adTimer = TextLabel(ad, "AdTimer", "5", 0, 25, 300, 120, 90, new Color32(167, 113, 61, 255));
            controller.adStatus = TextLabel(ad, "AdStatus", "广告播放中，请稍候…", 0, -82, 530, 70, 27, Ink);
            controller.adClose = Button(ad, "BtnCloseAd", "关闭广告", "button_secondary_normal", -130, -230, 230, 72, 26);
            controller.adReturn = Button(ad, "BtnReturnGame", "返回游戏", "button_secondary_normal", 130, -230, 230, 72, 26);
            result.gameObject.SetActive(false);
            ad.gameObject.SetActive(false);
            levels.gameObject.SetActive(false);
            game.gameObject.SetActive(false);
            rank.gameObject.SetActive(false);

            PlayerSettings.productName = "寻迹王国";
            PlayerSettings.companyName = "FindDifference";
            PlayerSettings.defaultScreenWidth = 750;
            PlayerSettings.defaultScreenHeight = 1334;
            PlayerSettings.defaultIsNativeResolution = false;
            Directory.CreateDirectory(Root + "/Scenes");
            var path = Root + "/Scenes/FindDifference.unity";
            EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), path);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(path, true) };
            AssetDatabase.SaveAssets();
            Debug.Log("FindDifference Unity 2D scene built: " + path);
        }

        static void PrepareSprites()
        {
            AssetDatabase.Refresh();
            foreach (var guid in AssetDatabase.FindAssets("t:Texture2D", new[] { Root + "/Resources" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var importer = AssetImporter.GetAtPath(path) as TextureImporter;
                if (importer == null) continue;
                bool sliced = path.Contains("/UI/") && !path.Contains("bg_") && !path.Contains("icon_");
                importer.textureType = TextureImporterType.Sprite;
                importer.spriteImportMode = SpriteImportMode.Single;
                importer.spritePixelsPerUnit = 100;
                importer.spriteBorder = sliced ? new Vector4(22, 22, 22, 22) : Vector4.zero;
                importer.mipmapEnabled = false;
                importer.maxTextureSize = 2048;
                importer.textureCompression = TextureImporterCompression.Compressed;
                importer.SaveAndReimport();
            }
        }

        static RectTransform UI(Transform parent, string name, float x, float y, float w, float h)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var rect = go.GetComponent<RectTransform>();
            rect.anchorMin = rect.anchorMax = new Vector2(.5f, .5f);
            rect.sizeDelta = new Vector2(w, h);
            rect.anchoredPosition = new Vector2(x, y);
            return rect;
        }

        static RectTransform Stretch(Transform parent, string name)
        {
            var r = UI(parent, name, 0, 0, 0, 0);
            r.anchorMin = Vector2.zero;
            r.anchorMax = Vector2.one;
            r.offsetMin = r.offsetMax = Vector2.zero;
            return r;
        }

        static Sprite Sprite(string path) => AssetDatabase.LoadAssetAtPath<Sprite>($"{Root}/Resources/{path}.png");

        static RectTransform Page(Transform parent, string name, string background)
        {
            var page = Stretch(parent, name);
            var image = Stretch(page, "Background").gameObject.AddComponent<Image>();
            image.sprite = Sprite("UI/" + background);
            image.type = Image.Type.Simple;
            image.preserveAspect = false;
            image.raycastTarget = false;
            return page;
        }

        static RectTransform Overlay(Transform parent, string name)
        {
            var overlay = Stretch(parent, name);
            var dim = Stretch(overlay, "Dimmer").gameObject.AddComponent<Image>();
            dim.color = new Color(0, .04f, .12f, .67f);
            dim.raycastTarget = true;
            return overlay;
        }

        static Image Panel(Transform parent, string name, string sprite, float x, float y, float w, float h, Color color)
        {
            var img = UI(parent, name, x, y, w, h).gameObject.AddComponent<Image>();
            img.sprite = Sprite("UI/" + sprite);
            img.type = Image.Type.Sliced;
            img.color = color;
            return img;
        }

        static Image Picture(Transform parent, string name, string sprite, float x, float y, float w, float h)
        {
            var img = UI(parent, name, x, y, w, h).gameObject.AddComponent<Image>();
            img.sprite = Sprite(sprite);
            img.preserveAspect = true;
            img.raycastTarget = false;
            return img;
        }

        static Text TextLabel(Transform parent, string name, string content, float x, float y, float w, float h, int size, Color color, FontStyle style = FontStyle.Normal)
        {
            var label = UI(parent, name, x, y, w, h).gameObject.AddComponent<Text>();
            label.font = font;
            label.text = content;
            label.fontSize = size;
            label.fontStyle = style;
            label.color = color;
            label.alignment = TextAnchor.MiddleCenter;
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
            label.verticalOverflow = VerticalWrapMode.Overflow;
            label.raycastTarget = false;
            return label;
        }

        static Button Button(Transform parent, string name, string caption, string sprite, float x, float y, float w, float h, int textSize)
        {
            var image = Panel(parent, name, sprite, x, y, w, h, Color.white);
            var button = image.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            var colors = button.colors;
            colors.highlightedColor = new Color(.97f, .96f, .94f);
            colors.pressedColor = new Color(.85f, .84f, .82f);
            button.colors = colors;
            TextLabel(button.transform, "Label", caption, 0, 0, w - 18, h - 12, textSize, Ink, FontStyle.Bold);
            return button;
        }

        static void MakeImageArea(Transform parent, string name, float y, out Image image, out RectTransform markers, FindDifferenceGame game)
        {
            var frame = Panel(parent, name, "image_frame", 0, y, 720, 500, Pale);
            frame.gameObject.AddComponent<RectMask2D>();
            image = Picture(frame.transform, "DifferenceImage", "Levels/level-01/scene-a", 0, 0, 700, 475);
            image.raycastTarget = true;
            var hit = image.gameObject.AddComponent<DifferenceHitArea>();
            hit.game = game;
            hit.image = image.rectTransform;
            markers = Stretch(image.transform, "FoundMarkers");
        }
    }
}
